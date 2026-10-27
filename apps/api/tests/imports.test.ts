// M10: CSV import of contacts and deals (FR-C10, FR-A07, T-ACL-03, CSV injection).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let app: ReturnType<typeof makeApp>['app'];
let manager: Agent;
let owner: Agent;

const send = (a: Agent, path: string, body: object = {}, headers: Record<string, string> = {}) => {
  let r = a.agent.post(`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);

/**
 * A large body sent to someone who may not import: the server answers 403 before reading it, so
 * the client either gets the 403 or sees the connection closed while still sending. Never 413.
 */
async function refusedBeforeReading(req: PromiseLike<request.Response>) {
  const outcome = await Promise.resolve(req).then(
    (r) => r.status,
    (e: NodeJS.ErrnoException) => e.code,
  );
  expect([401, 403, 'ECONNRESET', 'EPIPE']).toContain(outcome);
}
const BIG = `Name\n${'x'.repeat(1_500_000)}`;

const CONTACTS = [
  'Name,Email,Phone,Company,Source,Next follow-up,Owner',
  'Mona Hassan,mona@nile.test,+20 100 111 2222,Nile Foods,Referral,2026-12-01,salesa@agency.test',
  'Karim Adel,not-an-email,,Delta Co,,,',
  ',nobody@x.test,,,,,',
  'Existing Person,existing@agency.test,,,,,',
  'Mona Again,MONA@nile.test,,,,,',
  'Sara Fathy,,0100 222 3333,,Billboard,,',
  'Formula,=HYPERLINK("http://evil.test"),,=1+1,,,',
  '"Quoted, Name",quoted@x.test,,"Line one',
  'line two",,2026-13-40,',
].join('\r\n');

function preview(a: Agent, csv: string, extra: object = {}) {
  return send(a, '/imports/preview', { kind: 'contacts', filename: 'leads.csv', csv, ...extra });
}

/** Status check for helpers that return a promise rather than a supertest request. */
const is = (status: number) => (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};

async function commit(a: Agent, csv: string, extra: object = {}, key = randomUUID()) {
  // The preview takes the kind only; the commit options go with the commit.
  const kind = 'kind' in extra ? { kind: (extra as { kind: string }).kind } : {};
  const p = (await preview(a, csv, kind).expect(200)).body.data;
  return send(
    a,
    '/imports',
    {
      kind: p.kind,
      filename: 'leads.csv',
      csv,
      mapping: p.mapping,
      fileSha256: p.fileSha256,
      ...extra,
    },
    { 'Idempotency-Key': key },
  );
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app } = makeApp());
  await db.contact.create({
    data: {
      agencyId: seeded.agencyId,
      ownerId: seeded.users.salesB!.id,
      fullName: 'Existing Person',
      emailNorm: 'existing@agency.test',
    },
  });
  manager = await login(app, seeded.users.manager!.email);
  owner = await login(app, seeded.users.owner!.email);
});

describe('preview (FR-C10)', () => {
  it('suggests a mapping, checks every row and finds duplicates without writing anything', async () => {
    const before = await db.contact.count();
    const p = (await preview(manager, CONTACTS).expect(200)).body.data;
    expect(p.mapping).toMatchObject({
      fullName: 'Name',
      email: 'Email',
      phone: 'Phone',
      companyName: 'Company',
      source: 'Source',
      nextActionAt: 'Next follow-up',
      ownerEmail: 'Owner',
      lifecycle: null,
    });
    expect(p.fileErrors).toEqual([]);
    const byLine = Object.fromEntries(p.rows.map((r: { line: number }) => [r.line, r])) as Record<
      number,
      { status: string; errors: Record<string, string[]>; duplicateOf: unknown }
    >;
    expect(byLine[2]!.status).toBe('ready');
    expect(byLine[3]!.errors.email).toBeDefined();
    expect(byLine[4]!.errors.fullName).toBeDefined();
    expect(byLine[5]).toMatchObject({
      status: 'duplicate',
      duplicateOf: { kind: 'existing', label: 'Existing Person' },
    });
    // Case-insensitive email match with an earlier line of the same file.
    expect(byLine[6]).toMatchObject({
      status: 'duplicate',
      duplicateOf: { kind: 'line', line: 2 },
    });
    expect(byLine[7]!.errors.source).toBeDefined();
    // Formula-looking text is just text on the way in.
    expect(byLine[8]!.errors.email).toBeDefined();
    // A quoted field with a comma and a line break is one cell; it is one row starting on line 9.
    expect(byLine[9]!.errors.nextActionAt).toBeDefined();
    expect(p.counts).toEqual({ total: 8, ready: 1, duplicate: 2, error: 5 });
    expect(await db.contact.count()).toBe(before);
  });

  it('reads a BOM, semicolons and Arabic headers and names', async () => {
    const csv = '\uFEFFالاسم;البريد;الهاتف\nمنى حسن;mona@nile.test;01001112222\n';
    const p = (await preview(manager, csv).expect(200)).body.data;
    expect(p.headers).toEqual(['الاسم', 'البريد', 'الهاتف']);
    expect(p.mapping).toMatchObject({ fullName: 'الاسم', email: 'البريد', phone: 'الهاتف' });
    expect(p.rows[0]).toMatchObject({ status: 'ready', values: { fullName: 'منى حسن' } });
  });

  it('refuses files it cannot trust: wrong encoding, broken quotes, no name column, too big', async () => {
    const errs = async (csv: string, extra: object = {}) =>
      (await preview(manager, csv, extra).expect(200)).body.data.fileErrors as string[];
    expect((await errs('Name\nMon\uFFFD\n'))[0]).toContain('UTF-8');
    expect((await errs('Name,Email\n"Mona,mona@x.test\n'))[0]).toContain('could not be read');
    expect(await errs('Email\nmona@x.test\n')).toContain('Choose the column for “Name”.');
    expect(await errs('Name,Name\nA,B\n')).toEqual([
      'Two columns are called “Name”. Rename one of them.',
    ]);
    expect(await errs('Name\nA\n', { mapping: { fullName: 'Missing' } })).toContain(
      'The column “Missing” is not in the file.',
    );
    expect(await errs('Name\nA\n', { mapping: { fullName: 'Name', ownerId: 'Name' } })).toContain(
      '“ownerId” is not a field you can import.',
    );
    const many = ['Name', ...Array.from({ length: 2001 }, (_, i) => `Person ${i}`)].join('\n');
    expect((await errs(many))[0]).toContain('2001 rows');
    // Over 1 MB of CSV: refused by the schema; over the body limit: 413.
    await preview(manager, `Name\n${'x'.repeat(1_000_001)}`).expect(422);
    await preview(manager, `Name\n${'x'.repeat(2_200_000)}`).expect(413);
  });
});

describe('commit (FR-C10, FR-A07)', () => {
  it('creates only ready rows, records the run and audits counts without personal data', async () => {
    const res = await commit(manager, CONTACTS).then(is(201));
    expect(res.body.data.run).toMatchObject({
      kind: 'contacts',
      filename: 'leads.csv',
      rowsTotal: 8,
      rowsCreated: 1,
      rowsSkipped: 2,
      rowsFailed: 5,
    });
    expect(res.body.data.notImported.map((n: { line: number }) => n.line)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
    ]);
    const mona = await db.contact.findFirstOrThrow({ where: { emailNorm: 'mona@nile.test' } });
    expect(mona).toMatchObject({
      fullName: 'Mona Hassan',
      phoneNorm: '+201001112222',
      companyName: 'Nile Foods',
      source: 'REFERRAL',
      ownerId: seeded.users.salesA!.id,
      importRunId: res.body.data.run.id,
    });
    // 09:00 in Cairo (UTC+2 in December).
    expect(mona.nextActionAt?.toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(
      await db.activity.count({ where: { entityId: mona.id, eventType: 'contact.imported' } }),
    ).toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'import.contacts' } });
    expect(audit.metadataRedacted).toMatchObject({ created: 1, skipped: 2, failed: 5 });
    expect(JSON.stringify(audit.metadataRedacted)).not.toMatch(/mona|Nile|@/i);
    // The file itself is not stored anywhere: only its hash.
    const run = await db.importRun.findUniqueOrThrow({ where: { id: res.body.data.run.id } });
    expect(run.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await get(manager, '/imports').expect(200)).body.data).toHaveLength(1);
  });

  it('is idempotent per key and refuses a file that changed since the preview', async () => {
    const key = randomUUID();
    const first = await commit(manager, CONTACTS, {}, key).then(is(201));
    const count = await db.contact.count();
    const again = await commit(manager, CONTACTS, {}, key).then(is(200));
    expect(again.body.data).toMatchObject({ replayed: true, run: { id: first.body.data.run.id } });
    expect(await db.contact.count()).toBe(count);
    await commit(manager, CONTACTS, { duplicates: 'create' }, key).then(is(409));
    const p = (await preview(manager, CONTACTS).expect(200)).body.data;
    await send(
      manager,
      '/imports',
      {
        kind: 'contacts',
        csv: `${CONTACTS}\nExtra,extra@x.test,,,,,`,
        mapping: p.mapping,
        fileSha256: p.fileSha256,
      },
      { 'Idempotency-Key': randomUUID() },
    ).expect(409);
    await send(manager, '/imports', {
      kind: 'contacts',
      csv: CONTACTS,
      mapping: p.mapping,
      fileSha256: p.fileSha256,
    }).expect(422);
    // Mass assignment through the body is refused (strict schema).
    await send(
      manager,
      '/imports',
      {
        kind: 'contacts',
        csv: CONTACTS,
        mapping: p.mapping,
        fileSha256: p.fileSha256,
        agencyId: randomUUID(),
      },
      { 'Idempotency-Key': randomUUID() },
    ).expect(422);
  });

  it('two imports of the same file at once create each contact once', async () => {
    const csv = 'Name,Email\nA One,a1@x.test\nB Two,b2@x.test\n';
    const [a, b] = await Promise.all([commit(manager, csv), commit(owner, csv)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.run.rowsCreated + b.body.data.run.rowsCreated).toBe(2);
    expect(
      await db.contact.count({ where: { emailNorm: { in: ['a1@x.test', 'b2@x.test'] } } }),
    ).toBe(2);
  });

  it('keeps formula-looking text as text, and exports neutralize it', async () => {
    const csv = 'Name,Company\n=HYPERLINK("http://evil.test"),+cmd|calc\n';
    await commit(manager, csv).then(is(201));
    const c = await db.contact.findFirstOrThrow({ where: { companyName: '+cmd|calc' } });
    expect(c.fullName).toBe('=HYPERLINK("http://evil.test")');
    const deals = 'Deal name,Contact email\n=1+1,existing@agency.test\n';
    await commit(manager, deals, { kind: 'deals' }).then(is(201));
    const out = await get(manager, '/exports/deals.csv').expect(200);
    expect(out.text).toContain(`"'=1+1"`);
    expect(out.text).not.toMatch(/(^|,)"?=1\+1/m);
  });

  it('imports deals against existing contacts, stages by name and the agency currency', async () => {
    const csv = [
      'Deal name,Contact email,Value,Stage,Expected close,Owner email',
      'Website redesign,EXISTING@agency.test,"15,000.50",Proposal,2027-02-28,salesb@agency.test',
      'Unknown contact,ghost@x.test,100,,,',
      'Bad stage,existing@agency.test,100,Nowhere,,',
      'Bad value,existing@agency.test,EGP 100,,,',
      'Website redesign,existing@agency.test,1,,,',
    ].join('\n');
    const stages = await db.pipelineStage.findMany({
      where: { pipeline: { agencyId: seeded.agencyId } },
    });
    const proposal = stages.find((s) => s.name.toLowerCase() === 'proposal');
    expect(proposal).toBeDefined();
    const res = await commit(manager, csv, { kind: 'deals' }).then(is(201));
    expect(res.body.data.run).toMatchObject({ rowsCreated: 1, rowsSkipped: 1, rowsFailed: 3 });
    const deal = await db.deal.findFirstOrThrow({ where: { title: 'Website redesign' } });
    expect(deal).toMatchObject({
      amountMinor: 1_500_050n,
      currency: 'EGP',
      stageId: proposal!.id,
      ownerId: seeded.users.salesB!.id,
      status: 'OPEN',
    });
    expect(deal.expectedCloseOn?.toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('undo archives what the import created, except records changed since', async () => {
    const csv = 'Name,Email\nA One,a1@x.test\nB Two,b2@x.test\nC Three,c3@x.test\n';
    const run = (await commit(manager, csv).then(is(201))).body.data.run;
    const b = await db.contact.findFirstOrThrow({ where: { emailNorm: 'b2@x.test' } });
    await manager.agent
      .patch(`/api/v1/contacts/${b.id}`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', manager.csrf)
      .send({ version: b.version, companyName: 'Edited after import' })
      .expect(200);
    const undo = await send(manager, `/imports/${run.id}/undo`).expect(200);
    expect(undo.body.data).toMatchObject({ archived: 2, keptChanged: 1 });
    expect(undo.body.data.run.undoneAt).not.toBeNull();
    expect(
      await db.contact.count({ where: { importRunId: run.id, archivedAt: { not: null } } }),
    ).toBe(2);
    expect((await db.contact.findUniqueOrThrow({ where: { id: b.id } })).archivedAt).toBeNull();
    await send(manager, `/imports/${run.id}/undo`).expect(409);
    await send(manager, `/imports/${randomUUID()}/undo`).expect(404);
    expect(await db.auditEvent.count({ where: { action: 'import.undo' } })).toBe(1);
  });
});

describe('who may import (T-ACL-03)', () => {
  it('only owners, admins and sales managers; others cannot even send a large body', async () => {
    for (const who of ['salesA', 'pm', 'member', 'finance'] as const) {
      const a = await login(app, seeded.users[who]!.email);
      await preview(a, 'Name\nA\n').expect(403);
      await send(a, '/imports', { kind: 'contacts' }, { 'Idempotency-Key': randomUUID() }).expect(
        403,
      );
      await get(a, '/imports').expect(403);
      // The permission check comes before the 2 MB body is read.
      await refusedBeforeReading(preview(a, BIG));
    }
    // Signed out: refused before the body is read (no 413).
    await refusedBeforeReading(
      request(app)
        .post('/api/v1/imports/preview')
        .set('Origin', ORIGIN)
        .send({ kind: 'contacts', csv: BIG }),
    );
    const admin = await login(app, seeded.users.admin!.email);
    await preview(admin, 'Name\nA\n').expect(200);
  });
});
