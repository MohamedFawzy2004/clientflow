// M12.1 — antivirus for uploads through clamd's protocol (ADR-070), against a fake clamd that
// speaks the real INSTREAM framing. No ClamAV install is needed for the tests.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClamdScanner, parseScanReply } from '../src/lib/clamav.js';
import { makeProject } from './proposal-fixtures.js';
import { login, makeApp, ORIGIN, resetDb, seedAgency, testDb } from './helpers.js';

const db = testDb();
const MARKER = 'FAKE-MALWARE-FOR-TESTS';

/** A minimal clamd: PING → PONG; INSTREAM → FOUND when the bytes contain MARKER. */
function fakeClamd() {
  const received: Buffer[] = [];
  const server: Server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const data: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (command === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        command = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 1);
        if (command === 'zPING') {
          socket.end('PONG\0');
          return;
        }
      }
      while (buf.length >= 4) {
        const size = buf.readUInt32BE(0);
        if (size === 0) {
          const all = Buffer.concat(data);
          received.push(all);
          socket.end(all.includes(MARKER) ? `stream: Test.Fake-Malware FOUND\0` : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + size) return;
        data.push(buf.subarray(4, 4 + size));
        buf = buf.subarray(4 + size);
      }
    });
  });
  return { server, received };
}

describe('clamd protocol', () => {
  it('reads the three kinds of reply', () => {
    expect(parseScanReply('stream: OK\0')).toEqual({ clean: true });
    expect(parseScanReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      clean: false,
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseScanReply('INSTREAM size limit exceeded. ERROR\0')).toThrow(/Unexpected/);
  });
});

describe('uploads with a virus scanner', () => {
  const clamd = fakeClamd();
  let port = 0;
  let projectId = '';
  let member: Awaited<ReturnType<typeof login>>;

  beforeAll(async () => {
    await new Promise<void>((r) => clamd.server.listen(0, '127.0.0.1', () => r()));
    port = (clamd.server.address() as AddressInfo).port;
  });
  afterAll(() => {
    clamd.server.close();
  });

  async function setup(scanPort: number) {
    await resetDb();
    const seeded = await seedAgency();
    const { app } = makeApp({}, db, { scanner: new ClamdScanner('127.0.0.1', scanPort, 5000) });
    projectId = (
      await makeProject(db, {
        agencyId: seeded.agencyId,
        managerId: seeded.users.pm!.id,
        createdById: seeded.users.pm!.id,
        memberIds: [seeded.users.member!.id],
      })
    ).projectId;
    member = await login(app, seeded.users.member!.email);
    const owner = await login(app, seeded.users.owner!.email);
    return { app, owner };
  }
  const upload = (name: string, body: Buffer) =>
    member.agent
      .post(`/api/v1/projects/${projectId}/files`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', member.csrf)
      .set('X-File-Name', encodeURIComponent(name))
      .set('Content-Type', 'application/octet-stream')
      .send(body);

  beforeEach(() => {
    clamd.received.length = 0;
  });

  it('a clean file is stored; the scanner saw exactly its bytes, decrypted', async () => {
    await setup(port);
    const body = Buffer.from('plain project notes\n'.repeat(5000)); // ~100 KB, several chunks
    const res = await upload('notes.txt', body);
    expect(res.status).toBe(201);
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(file.scanDetail).toBe('Built-in checks and ClamAV passed.');
    expect(clamd.received).toHaveLength(1);
    expect(createHash('sha256').update(clamd.received[0]!).digest('hex')).toBe(file.sha256);
  });

  it('a flagged file is refused, not stored, and the detection is audited', async () => {
    await setup(port);
    const res = await upload('notes.txt', Buffer.from(`hello ${MARKER} world`));
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.file[0]).toMatch(/virus scanner flagged/);
    expect(await db.storedFile.count()).toBe(0);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'file.rejected' } });
    expect(audit.metadataRedacted).toMatchObject({
      reason: 'malware',
      signature: 'Test.Fake-Malware',
    });
  });

  it('when the scanner cannot be reached, uploads are refused (fail closed)', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const { owner } = await setup(deadPort);
    const res = await upload('notes.txt', Buffer.from('nothing wrong with me'));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(await db.storedFile.count()).toBe(0);
    const status = await owner.agent.get('/api/v1/ops/status').expect(200);
    expect(status.body.data.scanner).toBe('unreachable');
  });

  it('system status shows the scanner answering, or off when none is configured', async () => {
    const { owner } = await setup(port);
    expect((await owner.agent.get('/api/v1/ops/status')).body.data.scanner).toBe('ok');
    const plain = makeApp();
    const o = await login(plain.app, 'owner@agency.test');
    expect((await o.agent.get('/api/v1/ops/status')).body.data.scanner).toBe('off');
  });

  it('streams large files in chunks without holding them whole', async () => {
    const scanner = new ClamdScanner('127.0.0.1', port, 5000);
    const big = Buffer.alloc(3 * 1024 * 1024, 0x61);
    const result = await scanner.scan(
      Readable.from([big.subarray(0, 1_000_000), big.subarray(1_000_000)]),
    );
    expect(result).toEqual({ clean: true });
    expect(clamd.received[0]!.length).toBe(big.length);
  });
});

// Against a real clamd, when one is running: CLAMAV_TEST_HOST=127.0.0.1 (e.g. the official image).
describe.runIf(process.env.CLAMAV_TEST_HOST)('real ClamAV', () => {
  const scanner = new ClamdScanner(process.env.CLAMAV_TEST_HOST ?? '', 3310, 30_000);
  // Built from character codes: the standard EICAR test file, harmless by design.
  const eicar = String.fromCharCode(
    ...[
      88, 53, 79, 33, 80, 37, 64, 65, 80, 91, 52, 92, 80, 90, 88, 53, 52, 40, 80, 94, 41, 55, 67,
      67, 41, 55, 125, 36,
    ],
  ).concat('EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

  it('answers, passes a clean file and detects the EICAR test file', async () => {
    expect(await scanner.ping()).toBe(true);
    expect(await scanner.scan(Readable.from([Buffer.from('plain notes')]))).toEqual({
      clean: true,
    });
    const found = await scanner.scan(Readable.from([Buffer.from(eicar)]));
    expect(found).toMatchObject({ clean: false });
    expect(!found.clean && found.signature).toMatch(/Eicar/i);
  });
});
