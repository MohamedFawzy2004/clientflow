// ClamAV over clamd's TCP protocol (ADR-070): INSTREAM for uploads, PING for status. No library:
// the protocol is a few framed messages.
import { connect, type Socket } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface MalwareScanner {
  readonly name: string;
  /** Throws when the scanner cannot give an answer; callers must then refuse the file. */
  scan(source: Readable): Promise<ScanResult>;
  ping(): Promise<boolean>;
}

export class ScannerUnavailable extends Error {}

/** clamd answers `stream: OK`, `stream: <name> FOUND`, or an `... ERROR` line. */
export function parseScanReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (/^stream: OK$/.test(text)) return { clean: true };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { clean: false, signature: found[1]!.slice(0, 200) };
  throw new ScannerUnavailable(`Unexpected scanner reply: ${text.slice(0, 120)}`);
}

export class ClamdScanner implements MalwareScanner {
  readonly name = 'ClamAV';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  private open(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => resolve(socket));
      socket.once('error', (err) => reject(new ScannerUnavailable(err.message)));
      socket.once('timeout', () => {
        socket.destroy();
        reject(new ScannerUnavailable('The scanner did not answer in time.'));
      });
    });
  }

  private reply(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      socket.on('data', (c: Buffer) => chunks.push(c));
      socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.once('error', (err) => reject(new ScannerUnavailable(err.message)));
      socket.once('timeout', () => {
        socket.destroy();
        reject(new ScannerUnavailable('The scanner did not answer in time.'));
      });
    });
  }

  async scan(source: Readable): Promise<ScanResult> {
    const socket = await this.open();
    const answer = this.reply(socket);
    try {
      socket.write('zINSTREAM\0');
      for await (const chunk of source) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(data.length);
        // Respect back-pressure: a slow scanner must not make the whole file sit in memory.
        if (!socket.write(Buffer.concat([size, data]))) {
          await new Promise((r) => socket.once('drain', r));
        }
      }
      socket.end(Buffer.alloc(4)); // zero-length chunk: end of stream
    } catch (err) {
      socket.destroy();
      throw err instanceof ScannerUnavailable ? err : new ScannerUnavailable(String(err));
    }
    return parseScanReply(await answer);
  }

  async ping(): Promise<boolean> {
    try {
      const socket = await this.open();
      const answer = this.reply(socket);
      socket.end('zPING\0');
      return (await answer).replace(/\0/g, '').trim() === 'PONG';
    } catch {
      return false;
    }
  }
}
