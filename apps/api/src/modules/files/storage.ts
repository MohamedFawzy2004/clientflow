// Private file storage (SEC-12). A port with one adapter today: encrypted files on a local disk
// volume. An S3-compatible adapter can implement the same port once hosting is chosen (ADR-043).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** What an adapter needs to read an object back (stored on the `files` row). */
export interface StoredObjectMeta {
  iv: Uint8Array | null;
  tag: Uint8Array | null;
}

export interface FileStorage {
  /** Stores the bytes under `key`. On any error nothing is left behind. */
  put(key: string, source: AsyncIterable<Buffer>): Promise<StoredObjectMeta>;
  /** Plain bytes of a stored object. */
  get(key: string, meta: StoredObjectMeta): Readable;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * AES-256-GCM per file, random 96-bit nonce, tag kept in the database. Objects are named by a
 * random UUID, so a path never contains user input. The directory is never served statically.
 */
export class LocalEncryptedStorage implements FileStorage {
  private readonly root: string;

  constructor(
    dir: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error('File encryption key must be 32 bytes.');
    this.root = resolve(dir);
  }

  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key.');
    const p = join(this.root, key.slice(0, 2), `${key}.bin`);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key.');
    return p;
  }

  async put(key: string, source: AsyncIterable<Buffer>): Promise<StoredObjectMeta> {
    const final = this.pathFor(key);
    const temp = `${final}.part`;
    await mkdir(join(this.root, key.slice(0, 2)), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    try {
      await pipeline(Readable.from(source), cipher, createWriteStream(temp, { flags: 'wx' }));
      await rename(temp, final);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    return { iv, tag: cipher.getAuthTag() };
  }

  get(key: string, meta: StoredObjectMeta): Readable {
    if (!meta.iv || !meta.tag) throw new Error('Missing encryption metadata.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, meta.iv);
    decipher.setAuthTag(meta.tag);
    const out = new Transform({
      transform(chunk, _enc, cb) {
        cb(null, chunk);
      },
    });
    // A tampered or truncated object fails the GCM check and ends the stream with an error.
    pipeline(createReadStream(this.pathFor(key)), decipher, out).catch((err: unknown) =>
      out.destroy(err as Error),
    );
    return out;
  }

  async remove(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}
