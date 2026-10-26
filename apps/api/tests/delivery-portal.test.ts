// M7: private files, deliverables, explicit publish, portal sharing and client decisions
// (FR-S06 – FR-S10, FR-X01 – FR-X07, SEC-12, SEC-13, US-13, US-20, T-ACL-02, T-FILE-01/02).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF_SECRET } from './helpers.js';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  STORAGE_DIR,
  TEST_FILE_MAX_BYTES,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { makeClientOrg, makeProject } from './proposal-fixtures.js';
import request from 'supertest';
import { signDownloadLink } from '../src/modules/files/links.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let app: ReturnType<typeof makeApp>['app'];
let mailer: ReturnType<typeof makeApp>['mailer'];
let pm: Agent;
let member: Agent;
let client: Agent;
let clientB: Agent;
let projectId: string;
let orgId: string;
let clientUserId: string;

const PDF = Buffer.from(
  '%PDF-1.4\n% ClientFlow fixture\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n',
);

const send = (a: Agent, method: 'post' | 'patch', path: string, body: object = {}) =>
  a.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send(body);
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);

function upload(a: Agent, name: string, body: Buffer, type = 'application/octet-stream') {
  return a.agent
    .post(`/api/v1/projects/${projectId}/files`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', a.csrf)
    .set('X-File-Name', encodeURIComponent(name))
    .set('Content-Type', type)
    .send(body);
}

function binary(raw: unknown, cb: (err: Error | null, body: Buffer) => void) {
  const res = raw as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

function download(a: Agent, url: string) {
  return a.agent.get(url).buffer(true).parse(binary);
}

function storedObjects() {
  const out: string[] = [];
  for (const d of readdirSync(STORAGE_DIR)) {
    const p = join(STORAGE_DIR, d);
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) out.push(join(p, f));
  }
  return out;
}

async function pdfFile(name = 'Homepage design.pdf') {
  const res = await upload(member, name, PDF);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string; scanStatus: string };
}

/** A deliverable with one version, published by the PM. */
async function published(title = 'Homepage design') {
  const d = await send(member, 'post', `/projects/${projectId}/deliverables`, { title }).expect(
    201,
  );
  const f = await pdfFile(`${title}.pdf`);
  const v = await send(member, 'post', `/deliverables/${d.body.data.id}/versions`, {
    fileId: f.id,
    note: 'First round',
  }).expect(201);
  const pub = await send(pm, 'post', `/deliverables/${d.body.data.id}/publish`, {
    version: v.body.data.version,
  }).expect(200);
  return { id: d.body.data.id as string, fileId: f.id, detail: pub.body.data };
}

const share = () =>
  send(pm, 'post', `/projects/${projectId}/shares`, { userId: clientUserId }).expect(200);

async function deniedCount() {
  return db.auditEvent.count({ where: { action: 'portal.access_denied', outcome: 'DENIED' } });
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app, mailer } = makeApp());
  const owner = seeded.users.owner!.id;
  const contact = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId: owner, fullName: 'Omar Client' },
  });
  const orgA = await makeClientOrg(db, seeded.agencyId, contact.id, {
    name: 'Harbour Co.',
    email: 'omar@harbour.test',
  });
  orgId = orgA.orgId;
  clientUserId = orgA.clientUserId;
  const contactB = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId: owner, fullName: 'Other Client' },
  });
  await makeClientOrg(db, seeded.agencyId, contactB.id, {
    name: 'Other Co.',
    email: 'buyer@other.test',
  });
  projectId = (
    await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
      memberIds: [seeded.users.member!.id],
      clientOrgId: orgId,
    })
  ).projectId;
  pm = await login(app, seeded.users.pm!.email);
  member = await login(app, seeded.users.member!.email);
  client = await login(app, 'omar@harbour.test');
  clientB = await login(app, 'buyer@other.test');
});

describe('file uploads (SEC-12, FR-X06, FR-X07, T-FILE-02)', () => {
  it('stores an allowed file encrypted and serves the same bytes as a safe attachment', async () => {
    const before = storedObjects().length;
    // The browser's Content-Type is ignored: the server decides it from the allowlist.
    const res = await upload(member, '../../etc/Proposal\u0007 final.pdf', PDF, 'text/html');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Proposal final.pdf',
      extension: 'pdf',
      sizeBytes: PDF.length,
      scanStatus: 'CLEAN',
    });
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.mimeType).toBe('application/pdf');
    expect(row.storageKey).not.toContain('Proposal');

    // At rest the bytes are ciphertext.
    const objects = storedObjects();
    expect(objects.length).toBe(before + 1);
    const raw = readFileSync(objects.find((o) => o.includes(row.storageKey))!);
    expect(raw.includes(Buffer.from('%PDF'))).toBe(false);

    const link = await send(member, 'post', `/files/${row.id}/download-url`).expect(200);
    expect(link.body.data.url).toMatch(/^\/api\/v1\/files\/download\//);
    const dl = await download(member, link.body.data.url);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="Proposal final.pdf"/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(dl.headers['cache-control']).toContain('no-store');
  });

  it('refuses active content, wrong signatures, malware test files, empty and oversized files', async () => {
    const cases: Array<[string, Buffer, number]> = [
      ['page.html', Buffer.from('<html><script>alert(1)</script></html>'), 422],
      ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 422],
      ['tool.exe', Buffer.from('MZ\x90\x00'), 422],
      ['fake.pdf', Buffer.from('<html>not a pdf</html>'), 422],
      ['notes.txt', Buffer.from('hello <ScRiPt>steal()</script>'), 422],
      ['notes.md', Buffer.from('fine text\u0000with a null byte'), 422],
      [
        'eicar.txt',
        Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        422,
      ],
      ['empty.pdf', Buffer.alloc(0), 422],
      ['huge.pdf', Buffer.concat([PDF, Buffer.alloc(TEST_FILE_MAX_BYTES)]), 413],
    ];
    const before = storedObjects().length;
    for (const [name, body, status] of cases) {
      const res = await upload(member, name, body);
      expect({ name, status: res.status }).toEqual({ name, status });
    }
    expect(await db.storedFile.count()).toBe(0);
    // Nothing that failed a check stays in storage, not even a partial file.
    expect(storedObjects().length).toBe(before);
    expect(
      await db.auditEvent.count({ where: { action: 'file.rejected' } }),
    ).toBeGreaterThanOrEqual(7);

    // Plain text, CSV and images with the right signature are fine.
    await upload(member, 'brief.txt', Buffer.from('Plain brief, UTF-8: مرحبا')).expect(201);
    await upload(
      member,
      'pixel.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    ).expect(201);
  });

  it('download links are short-lived, bound to one user and checked again (SEC-13)', async () => {
    const f = await pdfFile();
    const link = (await send(member, 'post', `/files/${f.id}/download-url`).expect(200)).body.data;
    // Another staff member with access cannot use someone else's link.
    const pmDl = await download(pm, link.url);
    expect(pmDl.status).toBe(404);
    // Tampered and expired links look the same.
    await download(member, link.url.slice(0, -2) + 'xx').expect(404);
    const expired = signDownloadLink(
      CSRF_SECRET,
      f.id,
      seeded.users.member!.id,
      Date.now() - 10 * 60_000,
    );
    await download(member, `/api/v1/files/download/${expired.token}`).expect(404);
    // Signed out: 401.
    await request(app).get(link.url).expect(401);
    // Removed from the project after the link was made: refused.
    await send(
      pm,
      'post',
      `/projects/${projectId}/members/${seeded.users.member!.id}/remove`,
    ).expect(200);
    await download(member, link.url).expect(404);
  });

  it('only CLEAN files can be downloaded or used in a version (T-FILE-01)', async () => {
    const f = await pdfFile();
    await db.storedFile.update({
      where: { id: f.id },
      data: { scanStatus: 'PENDING', scannedAt: null },
    });
    await send(member, 'post', `/files/${f.id}/download-url`).expect(409);
    const d = await send(member, 'post', `/projects/${projectId}/deliverables`, {
      title: 'X',
    }).expect(201);
    await send(member, 'post', `/deliverables/${d.body.data.id}/versions`, { fileId: f.id }).expect(
      422,
    );
  });

  it('files are delivery data: sales get 403, other projects 404; uploaders delete unused files', async () => {
    const f = await pdfFile();
    const sales = await login(app, seeded.users.salesA!.email);
    await get(sales, `/projects/${projectId}/files`).expect(403);
    await send(sales, 'post', `/files/${f.id}/download-url`).expect(403);
    await send(client, 'post', `/files/${f.id}/download-url`).expect(403);
    await send(member, 'post', `/files/${f.id}/delete`).expect(200);
    expect(await db.storedFile.count()).toBe(0);
    const used = await published();
    await send(pm, 'post', `/files/${used.fileId}/delete`).expect(409);
  });
});

describe('deliverables and the client portal (FR-S06 – FR-S10, US-13, US-20)', () => {
  it('nothing reaches the portal before an explicit publish and an explicit share', async () => {
    const d = await send(member, 'post', `/projects/${projectId}/deliverables`, {
      title: 'Homepage design',
      reviewDueOn: '2026-11-15',
    }).expect(201);
    expect(d.body.data.status).toBe('DRAFT');
    const f = await pdfFile();
    const v = await send(member, 'post', `/deliverables/${d.body.data.id}/versions`, {
      fileId: f.id,
    }).expect(201);
    expect(v.body.data.status).toBe('READY');
    // Members prepare; only the manager publishes.
    await send(member, 'post', `/deliverables/${d.body.data.id}/publish`, {
      version: v.body.data.version,
    }).expect(403);

    // Not shared yet: the project does not exist for the client.
    await get(client, `/portal/projects/${projectId}`).expect(404);
    expect((await get(client, '/portal/projects').expect(200)).body.data).toEqual([]);
    await share();
    const before = (await get(client, `/portal/projects/${projectId}`).expect(200)).body.data;
    expect(before.deliverables).toEqual([]); // shared, but nothing published yet

    await send(pm, 'post', `/deliverables/${d.body.data.id}/publish`, {
      version: v.body.data.version,
    }).expect(200);
    const proj = (await get(client, `/portal/projects/${projectId}`).expect(200)).body.data;
    expect(proj.deliverables).toEqual([
      expect.objectContaining({ title: 'Homepage design', state: 'AWAITING_REVIEW', versionNo: 1 }),
    ]);
    // No internal fields in the portal payload (FR-X04).
    const json = JSON.stringify(proj);
    for (const key of ['budgetMinor', 'managerId', 'members', 'tasks', 'checklist', 'activities']) {
      expect(json).not.toContain(key);
    }
  });

  it('the client downloads the published file and approves once; repeats are idempotent', async () => {
    const { id, fileId } = await published();
    await share();
    const detail = (await get(client, `/portal/deliverables/${id}`).expect(200)).body.data;
    expect(detail.openVersionId).toBeTruthy();
    expect(detail.versions[0].note).toBe('First round');

    const link = (await send(client, 'post', `/portal/files/${fileId}/download-url`).expect(200))
      .body.data;
    const dl = await download(client, link.url);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);

    const approve = { versionId: detail.openVersionId, decision: 'APPROVE' };
    const results = await Promise.all([
      send(client, 'post', `/portal/deliverables/${id}/decision`, approve),
      send(client, 'post', `/portal/deliverables/${id}/decision`, approve),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.deliverableReview.count()).toBe(1);
    const after = results[0]!.body.data;
    expect(after.state).toBe('APPROVED');
    expect(after.openVersionId).toBeNull();
    await send(client, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: detail.openVersionId,
      decision: 'REJECT',
      reason: 'Changed my mind',
    }).expect(409);
    const row = await db.deliverable.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('APPROVED');
    // Approved work is closed: no new versions.
    const f2 = await pdfFile('v2.pdf');
    await send(member, 'post', `/deliverables/${id}/versions`, { fileId: f2.id }).expect(409);
    // The manager hears about it by email, with a link and no decision text (SEC-24).
    const mail = mailer.messages.filter((m) => m.kind === 'deliverable_decision');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe(seeded.users.pm!.email);
    expect(mail[0]!.text).toContain(`/app/projects/${projectId}/deliverables`);
    expect(mail[0]!.text).not.toContain('Homepage');
    expect(await db.auditEvent.count({ where: { action: 'deliverable.client_approved' } })).toBe(1);
  });

  it('revisions keep every version and decision; the client decides only on the latest published one', async () => {
    const { id } = await published();
    await share();
    const v1 = (await get(client, `/portal/deliverables/${id}`).expect(200)).body.data
      .openVersionId;
    const noReason = await send(client, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: v1,
      decision: 'REQUEST_REVISION',
    });
    expect(noReason.status).toBe(422);
    await send(client, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: v1,
      decision: 'REQUEST_REVISION',
      reason: 'Make the logo bigger',
    }).expect(200);

    const f2 = await pdfFile('Homepage v2.pdf');
    const added = await send(member, 'post', `/deliverables/${id}/versions`, {
      fileId: f2.id,
    }).expect(201);
    expect(added.body.data.status).toBe('READY');
    // Unpublished v2 is invisible; v1 is closed.
    const mid = (await get(client, `/portal/deliverables/${id}`).expect(200)).body.data;
    expect(mid.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([1]);
    expect(mid.state).toBe('CHANGES_REQUESTED');
    expect(mid.openVersionId).toBeNull();
    await send(client, 'post', `/portal/files/${f2.id}/download-url`).expect(404);

    await send(pm, 'post', `/deliverables/${id}/publish`, {
      version: added.body.data.version,
    }).expect(200);
    await send(client, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: v1,
      decision: 'APPROVE',
    }).expect(409);
    const latest = (await get(client, `/portal/deliverables/${id}`).expect(200)).body.data;
    await send(client, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: latest.openVersionId,
      decision: 'APPROVE',
    }).expect(200);

    const staff = (await get(pm, `/deliverables/${id}`).expect(200)).body.data;
    expect(
      staff.versions.map((v: { versionNo: number; review: { decision: string } | null }) => [
        v.versionNo,
        v.review?.decision,
      ]),
    ).toEqual([
      [2, 'APPROVED'],
      [1, 'REVISION_REQUESTED'],
    ]);
    expect(staff.versions[1].review.reason).toBe('Make the logo bigger');

    // History is immutable in the database itself.
    const pubV1 = await db.deliverableVersion.findFirstOrThrow({
      where: { deliverableId: id, versionNo: 1 },
    });
    await expect(
      db.deliverableVersion.update({ where: { id: pubV1.id }, data: { note: 'rewritten' } }),
    ).rejects.toThrow();
    await expect(db.deliverableVersion.delete({ where: { id: pubV1.id } })).rejects.toThrow();
    await expect(
      db.deliverableReview.updateMany({ data: { reason: 'rewritten' } }),
    ).rejects.toThrow();
  });

  it('silence never approves: past the review date it is overdue and still waiting (FR-S10)', async () => {
    const { id } = await published();
    await db.deliverable.update({ where: { id }, data: { reviewDueOn: new Date('2020-01-01') } });
    await share();
    const d = (await get(client, `/portal/deliverables/${id}`).expect(200)).body.data;
    expect(d).toMatchObject({ state: 'AWAITING_REVIEW', overdue: true });
    expect((await get(pm, `/deliverables/${id}`).expect(200)).body.data).toMatchObject({
      status: 'PUBLISHED',
      overdue: true,
    });
    const dash = await get(pm, '/dashboard/delivery').expect(200);
    expect(dash.body.data.deliverables).toEqual({ awaitingClient: 1, overdue: 1 });
  });

  it('publishing needs a client organization; a quarantined file never reaches the client', async () => {
    const { id, fileId } = await published();
    await share();
    await db.storedFile.update({
      where: { id: fileId },
      data: { scanStatus: 'QUARANTINED', scanDetail: 'Flagged later' },
    });
    await send(client, 'post', `/portal/files/${fileId}/download-url`).expect(404);

    const manual = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
      memberIds: [seeded.users.member!.id],
    });
    const prev = projectId;
    projectId = manual.projectId;
    const d = await send(member, 'post', `/projects/${projectId}/deliverables`, {
      title: 'X',
    }).expect(201);
    const f = await pdfFile();
    const v = await send(member, 'post', `/deliverables/${d.body.data.id}/versions`, {
      fileId: f.id,
    }).expect(201);
    const res = await send(pm, 'post', `/deliverables/${d.body.data.id}/publish`, {
      version: v.body.data.version,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/client organization/);
    projectId = prev;
    expect(id).toBeTruthy();
  });
});

describe('portal isolation (T-ACL-02, FR-X01)', () => {
  it('another organization gets 404 everywhere, and every attempt is logged as DENIED', async () => {
    const { id, fileId } = await published();
    await share();
    const before = await deniedCount();
    await get(clientB, `/portal/projects/${projectId}`).expect(404);
    await get(clientB, `/portal/deliverables/${id}`).expect(404);
    await send(clientB, 'post', `/portal/deliverables/${id}/decision`, {
      versionId: id,
      decision: 'APPROVE',
    }).expect(404);
    await send(clientB, 'post', `/portal/files/${fileId}/download-url`).expect(404);
    // A link made for client A is useless to client B.
    const link = (await send(client, 'post', `/portal/files/${fileId}/download-url`).expect(200))
      .body.data;
    await download(clientB, link.url).expect(404);
    expect((await get(clientB, '/portal/projects').expect(200)).body.data).toEqual([]);
    expect(await deniedCount()).toBe(before + 4);
    // Unknown IDs look exactly the same.
    const unknown = await get(clientB, '/portal/projects/0194f3b2-0000-7000-8000-000000000000');
    const foreign = await get(clientB, `/portal/projects/${projectId}`);
    expect(unknown.status).toBe(foreign.status);
    expect(unknown.body.error.message).toBe(foreign.body.error.message);
  });

  it('revoking a share ends access at once, including links already handed out', async () => {
    const { fileId } = await published();
    await share();
    const link = (await send(client, 'post', `/portal/files/${fileId}/download-url`).expect(200))
      .body.data;
    await send(pm, 'post', `/projects/${projectId}/shares/${clientUserId}/revoke`).expect(200);
    await get(client, `/portal/projects/${projectId}`).expect(404);
    await download(client, link.url).expect(404);
    // Sharing again restores it; the list shows who has access.
    const shares = (await share()).body.data;
    expect(shares.people).toEqual([
      expect.objectContaining({
        shared: true,
        user: expect.objectContaining({ id: clientUserId }),
      }),
    ]);
    await get(client, `/portal/projects/${projectId}`).expect(200);
  });

  it('projects are shared only with client users of their own organization', async () => {
    const other = await db.user.findFirstOrThrow({ where: { emailNorm: 'buyer@other.test' } });
    const res = await send(pm, 'post', `/projects/${projectId}/shares`, { userId: other.id });
    expect(res.status).toBe(422);
    await send(pm, 'post', `/projects/${projectId}/shares`, {
      userId: seeded.users.member!.id,
    }).expect(422);
    await send(member, 'post', `/projects/${projectId}/shares`, { userId: clientUserId }).expect(
      403,
    );
    // The database refuses it too.
    await expect(
      db.projectShare.create({
        data: {
          agencyId: seeded.agencyId,
          projectId,
          userId: other.id,
          sharedById: seeded.users.pm!.id,
        },
      }),
    ).rejects.toThrow();
    expect(await db.projectShare.count()).toBe(0);
  });

  it('changing the client organization of a manual project ends existing shares', async () => {
    await share();
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const otherOrg = await db.clientOrganization.findFirstOrThrow({ where: { name: 'Other Co.' } });
    await send(pm, 'patch', `/projects/${projectId}`, {
      version: p.version,
      clientOrgId: otherOrg.id,
    }).expect(200);
    expect(await db.projectShare.count({ where: { revokedAt: null } })).toBe(0);
    await get(client, `/portal/projects/${projectId}`).expect(404);
  });

  it('archived projects leave the portal', async () => {
    await published();
    await share();
    await db.project.update({ where: { id: projectId }, data: { state: 'ARCHIVED' } });
    expect((await get(client, '/portal/projects').expect(200)).body.data).toEqual([]);
    await get(client, `/portal/projects/${projectId}`).expect(404);
  });
});
