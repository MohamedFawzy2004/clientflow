// M8: change requests (FR-S01 – FR-S05, US-12, T-SCOPE-01/02) and client comments (FR-X08).
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
import { makeClientOrg, makeProject } from './proposal-fixtures.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let app: ReturnType<typeof makeApp>['app'];
let mailer: ReturnType<typeof makeApp>['mailer'];
let pm: Agent;
let owner: Agent;
let member: Agent;
let client: Agent;
let clientB: Agent;
let projectId: string;
let clientUserId: string;

const send = (a: Agent, method: 'post' | 'patch' | 'put', path: string, body: object = {}) =>
  a.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send(body);
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);

const project = () => db.project.findUniqueOrThrow({ where: { id: projectId } });
const denied = () =>
  db.auditEvent.count({ where: { action: 'portal.access_denied', outcome: 'DENIED' } });

/** A change estimated at 12,500.00 EGP with two work items and a new due date. */
async function estimated(title = 'Arabic version') {
  const c = await send(pm, 'post', `/projects/${projectId}/changes`, {
    title,
    description: 'Add an Arabic version of every page.',
    justification: 'New market',
  }).expect(201);
  const d = await send(pm, 'put', `/changes/${c.body.data.id}/draft`, {
    version: c.body.data.version,
    scope: 'Translate and lay out all 8 pages right to left.',
    workItems: '- Translate pages\n- RTL layout review',
    estimateMinutes: 1200,
    price: '12500.00',
    newDueOn: '2027-04-30',
  }).expect(200);
  return d.body.data as { id: string; version: number; status: string };
}

/** Estimated, approved by the owner and sent to the client. */
async function sentChange(title?: string) {
  const d = await estimated(title);
  const s = await send(pm, 'post', `/changes/${d.id}/submit`, { version: d.version }).expect(200);
  const a = await send(owner, 'post', `/changes/${d.id}/review`, {
    version: s.body.data.version,
    decision: 'APPROVE',
  }).expect(200);
  const out = await send(pm, 'post', `/changes/${d.id}/send`, {
    version: a.body.data.version,
  }).expect(200);
  return out.body.data as { id: string; versions: Array<{ contentHash: string }> };
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app, mailer } = makeApp());
  const ownerId = seeded.users.owner!.id;
  const contact = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId, fullName: 'Client contact' },
  });
  const org = await makeClientOrg(db, seeded.agencyId, contact.id, { email: 'a@client.test' });
  clientUserId = org.clientUserId;
  const contactB = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId, fullName: 'Other contact' },
  });
  await makeClientOrg(db, seeded.agencyId, contactB.id, { email: 'b@other.test' });
  projectId = (
    await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
      memberIds: [seeded.users.member!.id],
      clientOrgId: org.orgId,
    })
  ).projectId;
  await db.project.update({
    where: { id: projectId },
    data: { state: 'ACTIVE', budgetMinor: 6_000_000n, dueOn: new Date('2027-03-31') },
  });
  await db.projectShare.create({
    data: {
      agencyId: seeded.agencyId,
      projectId,
      userId: clientUserId,
      sharedById: seeded.users.pm!.id,
    },
  });
  pm = await login(app, seeded.users.pm!.email);
  owner = await login(app, seeded.users.owner!.email);
  member = await login(app, seeded.users.member!.email);
  client = await login(app, 'a@client.test');
  clientB = await login(app, 'b@other.test');
});

describe('change requests: estimate, approval, send (FR-S01, FR-S02)', () => {
  it('a priced change needs owner approval before the client sees it', async () => {
    const d = await estimated();
    expect(d.status).toBe('ESTIMATING');
    const detail = (await get(pm, `/changes/${d.id}`).expect(200)).body.data;
    expect(detail.versions[0]).toMatchObject({
      versionNo: 1,
      status: 'DRAFT',
      priceMinor: '1250000',
      taxRateBp: 1400,
      taxMinor: '175000',
      totalMinor: '1425000',
      newDueOn: '2027-04-30',
      workItems: ['Translate pages', 'RTL layout review'],
    });
    expect(detail.needsApproval).toBe(true);

    // Not sendable yet, and invisible to the client.
    await send(pm, 'post', `/changes/${d.id}/send`, { version: d.version }).expect(409);
    expect(
      (await get(client, `/portal/projects/${projectId}/changes`).expect(200)).body.data,
    ).toEqual([]);
    await get(client, `/portal/changes/${d.id}`).expect(404);

    const s = await send(pm, 'post', `/changes/${d.id}/submit`, { version: d.version }).expect(200);
    expect(s.body.data.status).toBe('IN_REVIEW');
    // The PM cannot approve (role), the draft cannot be edited while in review.
    await send(pm, 'post', `/changes/${d.id}/review`, {
      version: s.body.data.version,
      decision: 'APPROVE',
    }).expect(403);
    await send(pm, 'put', `/changes/${d.id}/draft`, {
      version: s.body.data.version,
      scope: 'Sneaky edit',
      price: '1.00',
    }).expect(409);
    // Returned for changes: back to a draft.
    const back = await send(owner, 'post', `/changes/${d.id}/review`, {
      version: s.body.data.version,
      decision: 'RETURN',
      comment: 'Price the RTL review separately',
    }).expect(200);
    expect(back.body.data.status).toBe('ESTIMATING');
    expect(back.body.data.versions[0].status).toBe('DRAFT');

    const s2 = await send(pm, 'post', `/changes/${d.id}/submit`, {
      version: back.body.data.version,
    }).expect(200);
    const ok = await send(owner, 'post', `/changes/${d.id}/review`, {
      version: s2.body.data.version,
      decision: 'APPROVE',
    }).expect(200);
    expect(ok.body.data.versions[0]).toMatchObject({
      status: 'APPROVED_INTERNAL',
      approvedBy: 'Olivia Owner',
    });
    const sent = await send(pm, 'post', `/changes/${d.id}/send`, {
      version: ok.body.data.version,
    }).expect(200);
    expect(sent.body.data.status).toBe('AWAITING_CLIENT');
    expect(sent.body.data.versions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The shared client gets a link-only email.
    const mail = mailer.messages.filter((m) => m.kind === 'change_sent');
    expect(mail.map((m) => m.to)).toEqual(['a@client.test']);
    expect(mail[0]!.text).not.toContain('12');
  });

  it('a change without a price is sent directly; submitting it is refused', async () => {
    const c = await send(pm, 'post', `/projects/${projectId}/changes`, {
      title: 'Move launch',
      description: 'Launch two weeks later.',
    }).expect(201);
    const d = await send(pm, 'put', `/changes/${c.body.data.id}/draft`, {
      version: 1,
      scope: 'Timeline only, no extra work.',
      price: '0',
      newDueOn: '2027-04-14',
    }).expect(200);
    await send(pm, 'post', `/changes/${d.body.data.id}/submit`, {
      version: d.body.data.version,
    }).expect(409);
    await send(pm, 'post', `/changes/${d.body.data.id}/send`, {
      version: d.body.data.version,
    }).expect(200);
  });

  it('members and sales read changes but cannot create, estimate or send them', async () => {
    const d = await estimated();
    await get(member, `/changes/${d.id}`).expect(200);
    await send(member, 'post', `/projects/${projectId}/changes`, {
      title: 'X',
      description: 'Member request',
    }).expect(403);
    await send(member, 'put', `/changes/${d.id}/draft`, {
      version: d.version,
      scope: 'x',
      price: '1',
    }).expect(403);
    await send(member, 'post', `/changes/${d.id}/withdraw`, {
      version: d.version,
      reason: 'no',
    }).expect(403);
    expect((await db.changeRequest.findUniqueOrThrow({ where: { id: d.id } })).version).toBe(
      d.version,
    );
  });

  it('withdrawing needs a reason, and closes the change for good', async () => {
    const d = await estimated();
    await send(pm, 'post', `/changes/${d.id}/withdraw`, { version: d.version, reason: '' }).expect(
      422,
    );
    await send(pm, 'post', `/changes/${d.id}/withdraw`, {
      version: d.version + 5,
      reason: 'Client changed plans',
    }).expect(409);
    const w = await send(pm, 'post', `/changes/${d.id}/withdraw`, {
      version: d.version,
      reason: 'Client changed plans',
    }).expect(200);
    expect(w.body.data).toMatchObject({
      status: 'WITHDRAWN',
      withdrawnReason: 'Client changed plans',
    });
    await send(pm, 'put', `/changes/${d.id}/draft`, {
      version: w.body.data.version,
      scope: 'Again',
      price: '1',
    }).expect(409);
  });
});

describe('the client decides; only acceptance changes the baseline (FR-S03, FR-S04)', () => {
  it('T-SCOPE-02: accepting updates budget, due date and tasks in one go, once', async () => {
    const c = await sentChange();
    const hash = c.versions[0]!.contentHash;
    const view = (await get(client, `/portal/changes/${c.id}`).expect(200)).body.data;
    expect(view.open).toMatchObject({
      contentHash: hash,
      priceMinor: '1250000',
      totalMinor: '1425000',
    });
    // Internal estimates never reach the client.
    expect(JSON.stringify(view)).not.toContain('estimateMinutes');
    expect(JSON.stringify(view)).not.toContain('1200');

    const accept = { decision: 'ACCEPT', contentHash: hash };
    const results = await Promise.all([
      send(client, 'post', `/portal/changes/${c.id}/decision`, accept),
      send(client, 'post', `/portal/changes/${c.id}/decision`, accept),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.changeDecision.count()).toBe(1);

    const p = await project();
    expect(p.budgetMinor).toBe(7_250_000n);
    expect(p.dueOn?.toISOString().slice(0, 10)).toBe('2027-04-30');
    const tasks = await db.task.findMany({
      where: { changeRequestId: c.id },
      orderBy: { title: 'asc' },
    });
    expect(tasks.map((t) => [t.title, t.scope])).toEqual([
      ['RTL layout review', 'CHANGE'],
      ['Translate pages', 'CHANGE'],
    ]);
    const staff = (await get(pm, `/changes/${c.id}`).expect(200)).body.data;
    expect(staff.status).toBe('ACCEPTED');
    expect(staff.versions[0].effect).toEqual({
      budgetBeforeMinor: '6000000',
      budgetAfterMinor: '7250000',
      dueBefore: '2027-03-31',
    });
    expect(staff.tasks).toHaveLength(2);
    const detail = (await get(pm, `/projects/${projectId}`).expect(200)).body.data;
    expect(detail.scopeHistory).toMatchObject({
      originalBudgetMinor: '6000000',
      currentBudgetMinor: '7250000',
      changes: [expect.objectContaining({ reference: 'CR-1', priceMinor: '1250000' })],
    });

    // A different decision afterwards is refused, and nothing moves again.
    await send(client, 'post', `/portal/changes/${c.id}/decision`, {
      decision: 'REJECT',
      contentHash: hash,
      reason: 'Too late',
    }).expect(409);
    expect((await project()).budgetMinor).toBe(7_250_000n);
    expect(mailer.messages.filter((m) => m.kind === 'change_decision')).toHaveLength(1);
  });

  it('T-SCOPE-01: rejecting leaves scope, budget, due date and tasks unchanged', async () => {
    const c = await sentChange();
    const before = await project();
    await send(client, 'post', `/portal/changes/${c.id}/decision`, {
      decision: 'REJECT',
      contentHash: c.versions[0]!.contentHash,
    }).expect(422);
    await send(client, 'post', `/portal/changes/${c.id}/decision`, {
      decision: 'REJECT',
      contentHash: c.versions[0]!.contentHash,
      reason: 'Not in this year’s budget',
    }).expect(200);
    const after = await project();
    expect(after.budgetMinor).toBe(before.budgetMinor);
    expect(after.dueOn).toEqual(before.dueOn);
    expect(after.version).toBe(before.version);
    expect(await db.task.count({ where: { projectId } })).toBe(0);
    expect((await get(pm, `/changes/${c.id}`).expect(200)).body.data.status).toBe('REJECTED');
  });

  it('a sent version is frozen: edits are refused by the API and the database', async () => {
    const c = await sentChange();
    const cr = await db.changeRequest.findUniqueOrThrow({ where: { id: c.id } });
    await send(pm, 'put', `/changes/${c.id}/draft`, {
      version: cr.version,
      scope: 'Different',
      price: '1.00',
    }).expect(409);
    const v = await db.changeVersion.findFirstOrThrow({ where: { changeRequestId: c.id } });
    await expect(
      db.changeVersion.update({
        where: { id: v.id },
        data: { priceMinor: 1n, totalMinor: 1n, taxMinor: 0n },
      }),
    ).rejects.toThrow();
    await expect(db.changeVersion.delete({ where: { id: v.id } })).rejects.toThrow();
    // A stale hash (the client looked at something else) is refused.
    await send(client, 'post', `/portal/changes/${c.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'f'.repeat(64),
    }).expect(409);
  });

  it('a project waiting for a client decision on a change cannot be completed', async () => {
    const c = await sentChange();
    const res = await send(pm, 'post', `/projects/${projectId}/state`, {
      version: (await project()).version,
      state: 'COMPLETED',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/change request is waiting/);
    expect(c.id).toBeTruthy();
  });
});

describe('client requests and isolation (FR-S01, T-ACL-02)', () => {
  it('a client requests a change; the PM hears about it; another client sees nothing', async () => {
    const r = await send(client, 'post', `/portal/projects/${projectId}/changes`, {
      title: 'Add a blog',
      description: 'We want a simple blog section.',
    }).expect(201);
    expect(r.body.data).toMatchObject({
      reference: 'CR-1',
      status: 'REQUESTED',
      requestedByYou: true,
      open: null,
    });
    expect(mailer.messages.filter((m) => m.kind === 'change_requested').map((m) => m.to)).toEqual([
      seeded.users.pm!.email,
    ]);
    const staff = (await get(pm, `/projects/${projectId}/changes`).expect(200)).body.data.changes;
    expect(staff[0].requestedBy).toMatchObject({ client: true });

    // While the agency estimates and reviews it, the client sees "Estimating", not the draft.
    const d = await send(pm, 'put', `/changes/${r.body.data.id}/draft`, {
      version: 1,
      scope: 'Blog with 3 templates',
      price: '9000',
    }).expect(200);
    await send(pm, 'post', `/changes/${d.body.data.id}/submit`, {
      version: d.body.data.version,
    }).expect(200);
    const mid = (await get(client, `/portal/changes/${r.body.data.id}`).expect(200)).body.data;
    expect(mid).toMatchObject({ status: 'ESTIMATING', versions: [], open: null });

    const before = await denied();
    await get(clientB, `/portal/projects/${projectId}/changes`).expect(404);
    await get(clientB, `/portal/changes/${r.body.data.id}`).expect(404);
    await send(clientB, 'post', `/portal/projects/${projectId}/changes`, {
      title: 'Sneaky',
      description: 'From another company',
    }).expect(404);
    await send(clientB, 'post', `/portal/changes/${r.body.data.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'a'.repeat(64),
    }).expect(404);
    expect(await denied()).toBe(before + 4);
    expect(await db.changeRequest.count()).toBe(1);
  });

  it('changes the agency drafted are invisible to the client until sent', async () => {
    const d = await estimated();
    await get(client, `/portal/changes/${d.id}`).expect(404);
    // Revoking the share closes the portal view at once.
    const c = await sentChange('Second');
    await get(client, `/portal/changes/${c.id}`).expect(200);
    await send(pm, 'post', `/projects/${projectId}/shares/${clientUserId}/revoke`).expect(200);
    await get(client, `/portal/changes/${c.id}`).expect(404);
  });
});

describe('tasks outside the original scope (FR-S05)', () => {
  it('need an accepted change of this project or a written exception', async () => {
    const pending = await estimated();
    const bad = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Extra',
      scope: 'CHANGE',
      changeRequestId: pending.id,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fieldErrors.changeRequestId).toBeDefined();
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Extra',
      scope: 'CHANGE',
    }).expect(422);
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Hotfix',
      scope: 'EXCEPTION',
      scopeNote: 'short',
    }).expect(422);
    const ex = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Hotfix',
      scope: 'EXCEPTION',
      scopeNote: 'Security fix the client asked for by phone',
    }).expect(201);
    expect(ex.body.data).toMatchObject({ scope: 'EXCEPTION', change: null });
    expect(
      await db.auditEvent.count({
        where: {
          action: 'task.create',
          metadataRedacted: { path: ['scope'], equals: 'EXCEPTION' },
        },
      }),
    ).toBe(1);

    const c = await sentChange('Accepted one');
    await send(client, 'post', `/portal/changes/${c.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: c.versions[0]!.contentHash,
    }).expect(200);
    const linked = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'More extra',
      scope: 'CHANGE',
      changeRequestId: c.id,
      assigneeId: seeded.users.member!.id,
    }).expect(201);
    expect(linked.body.data.change).toEqual({ id: c.id, reference: 'CR-2' });

    // The database refuses a link to a change that is not accepted.
    const t = await db.task.findUniqueOrThrow({ where: { id: ex.body.data.id } });
    await expect(
      db.task.update({
        where: { id: t.id },
        data: { scope: 'CHANGE', changeRequestId: pending.id, scopeNote: null },
      }),
    ).rejects.toThrow();

    // Time on extra work is shown apart from the original scope.
    await send(member, 'post', `/tasks/${linked.body.data.id}/time`, {
      workedOn: '2026-10-20',
      minutes: 45,
    }).expect(201);
    const time = (await get(pm, `/projects/${projectId}/time`).expect(200)).body.data;
    expect(time.byScope).toEqual({ BASELINE: 0, CHANGE: 45, EXCEPTION: 0 });
  });
});

describe('comments with edit history (FR-X08)', () => {
  it('the team and the client discuss a change; edits keep history; others cannot edit', async () => {
    const c = await sentChange();
    const thread = `entityType=change&entityId=${c.id}`;
    const first = await send(client, 'post', '/portal/comments', {
      entityType: 'change',
      entityId: c.id,
      body: 'Can the RTL review be done in March?',
    }).expect(201);
    expect(mailer.messages.filter((m) => m.kind === 'client_comment')).toHaveLength(1);
    await send(pm, 'post', `/projects/${projectId}/comments`, {
      entityType: 'change',
      entityId: c.id,
      body: 'Yes, early March.',
    }).expect(201);

    const seen = (await get(client, `/portal/comments?${thread}`).expect(200)).body.data;
    expect(
      seen.map((x: { body: string; author: { client: boolean } }) => [x.body, x.author.client]),
    ).toEqual([
      ['Can the RTL review be done in March?', true],
      ['Yes, early March.', false],
    ]);

    const edited = await send(client, 'patch', `/portal/comments/${first.body.data.id}`, {
      version: 1,
      body: 'Can the RTL review be done in early March?',
    }).expect(200);
    expect(edited.body.data.editedAt).not.toBeNull();
    // Someone else cannot change it; the PM cannot either.
    await send(pm, 'patch', `/comments/${first.body.data.id}`, {
      version: 2,
      body: 'Changed',
    }).expect(403);
    const history = (await get(pm, `/comments/${first.body.data.id}/history`).expect(200)).body
      .data;
    expect(history.map((h: { body: string }) => h.body)).toEqual([
      'Can the RTL review be done in March?',
    ]);
    expect(
      (await get(client, `/portal/comments/${first.body.data.id}/history`).expect(200)).body.data,
    ).toHaveLength(1);

    await send(client, 'post', `/portal/comments/${first.body.data.id}/delete`, {
      version: 2,
    }).expect(200);
    const after = (await get(pm, `/projects/${projectId}/comments?${thread}`).expect(200)).body
      .data;
    expect(after[0]).toMatchObject({ deleted: true, body: null });
    await expect(db.projectCommentRevision.deleteMany({})).rejects.toThrow();

    // Another organization's client sees nothing.
    const before = await denied();
    await get(clientB, `/portal/comments?${thread}`).expect(404);
    await send(clientB, 'post', '/portal/comments', {
      entityType: 'change',
      entityId: c.id,
      body: 'Hi',
    }).expect(404);
    await get(clientB, `/portal/comments/${first.body.data.id}/history`).expect(404);
    expect(await denied()).toBe(before + 3);
  });

  it('clients cannot comment on what they cannot see; sales have no comment access', async () => {
    const d = await estimated();
    await send(client, 'post', '/portal/comments', {
      entityType: 'change',
      entityId: d.id,
      body: 'Hello',
    }).expect(404);
    const sales = await login(app, seeded.users.salesA!.email);
    await get(sales, `/projects/${projectId}/comments?entityType=change&entityId=${d.id}`).expect(
      403,
    );
    expect(await db.projectComment.count()).toBe(0);
  });
});
