// Deal and project outcomes under simultaneous requests (backend audit, batch 1).
// A second connection holds a row lock to stop one transaction at a known point, so each race
// runs the same way every time.
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDeal } from '../src/modules/deals/service.js';
import { publishDeliverable } from '../src/modules/deliverables/service.js';
import { decideOnProposal } from '../src/modules/portal/service.js';
import { changeProjectState, removeMember } from '../src/modules/projects/service.js';
import { updateTask } from '../src/modules/tasks/service.js';
import type { AuthUser } from '../src/types/express.js';
import { resetDb, seedAgency, testDb, type SeededAgency } from './helpers.js';
import {
  FIXTURE_HASH,
  makeClientOrg,
  makeDeal,
  makeProject,
  makeProposal,
} from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
/** Lock connections still open; a failed test must not leave its locks for the next one. */
const open = new Set<pg.Client>();

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
});
afterEach(async () => {
  for (const c of open) await c.end().catch(() => undefined);
  open.clear();
});
afterAll(() => db.$disconnect());

/** A separate connection that holds row locks for the duration of a test step. */
async function locker() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  open.add(c);
  await c.query('BEGIN');
  return {
    lock: (sql: string, id: string) => c.query(sql, [id]),
    release: async () => {
      await c.query('COMMIT');
      open.delete(c);
      await c.end();
    },
  };
}

/** Waits until `n` backends of this database are blocked on a lock. */
async function waitForWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.n) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`fewer than ${n} transactions ever waited on a lock`);
}

const statusOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 200 : (r.reason as { status?: number }).status;

function staff(key: string): AuthUser {
  const u = seeded.users[key]!;
  return {
    id: u.id,
    agencyId: seeded.agencyId,
    name: key,
    emailNorm: u.email,
    role: u.role,
    clientOrgId: null,
  };
}

const accept = { decision: 'ACCEPT', contentHash: FIXTURE_HASH, comment: null } as never;

async function dealWithClient() {
  const owner = staff('owner');
  const deal = await makeDeal(db, seeded.agencyId, owner.id);
  const org = await makeClientOrg(db, seeded.agencyId, deal.contactId);
  const client: AuthUser = {
    id: org.clientUserId,
    agencyId: seeded.agencyId,
    name: 'Client',
    emailNorm: org.clientEmail,
    role: 'CLIENT',
    clientOrgId: org.orgId,
  };
  const proposal = () =>
    makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: deal.id,
      createdById: owner.id,
      status: 'SENT',
      clientOrgId: org.orgId,
    });
  return { owner, deal, client, proposal };
}

describe('client acceptance and the deal (F1)', () => {
  it('two proposals of one deal accepted at once: one wins, the other is refused', async () => {
    const { deal, client, proposal } = await dealWithClient();
    const a = await proposal();
    const b = await proposal();
    const l = await locker();
    await l.lock('SELECT id FROM deals WHERE id = $1 FOR UPDATE', deal.id);
    const both = [a, b].map((p) =>
      decideOnProposal({ db } as never, client, p.proposalId, accept, 'r'),
    );
    await waitForWaiters(2);
    await l.release();
    const results = await Promise.allSettled(both);

    expect(results.map(statusOf).sort()).toEqual([200, 409]);
    const accepted = await db.proposalVersion.findMany({
      where: { proposal: { dealId: deal.id }, status: 'ACCEPTED' },
    });
    expect(accepted).toHaveLength(1);
    const d = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d).toMatchObject({ status: 'WON', acceptedProposalVersionId: accepted[0]!.id });
  });

  it('staff marks the deal lost first: the client acceptance is refused', async () => {
    const { owner, deal, client, proposal } = await dealWithClient();
    const a = await proposal();
    const l = await locker();
    await l.lock('SELECT id FROM deals WHERE id = $1 FOR UPDATE', deal.id);
    const lost = closeDeal(
      db,
      owner,
      deal.id,
      { outcome: 'LOST', reason: 'Went elsewhere', version: deal.version } as never,
      'r1',
    );
    await waitForWaiters(1);
    const accepted = decideOnProposal({ db } as never, client, a.proposalId, accept, 'r2');
    await waitForWaiters(2);
    await l.release();
    const [rLost, rAccept] = await Promise.allSettled([lost, accepted]);

    expect([statusOf(rLost), statusOf(rAccept)]).toEqual([200, 409]);
    const d = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d).toMatchObject({ status: 'LOST', acceptedProposalVersionId: null });
    const v = await db.proposalVersion.findUniqueOrThrow({ where: { id: a.versionId } });
    expect(v.status).toBe('SENT');
  });

  it('the client accepts first: staff closing the deal as lost is refused', async () => {
    const { owner, deal, client, proposal } = await dealWithClient();
    const a = await proposal();
    const l = await locker();
    // The acceptance takes the deal lock, then waits here on its version row.
    await l.lock('SELECT id FROM proposal_versions WHERE id = $1 FOR UPDATE', a.versionId);
    const accepted = decideOnProposal({ db } as never, client, a.proposalId, accept, 'r1');
    await waitForWaiters(1);
    const lost = closeDeal(
      db,
      owner,
      deal.id,
      { outcome: 'LOST', reason: 'Went elsewhere', version: deal.version } as never,
      'r2',
    );
    await waitForWaiters(2);
    await l.release();
    const [rAccept, rLost] = await Promise.allSettled([accepted, lost]);

    expect([statusOf(rAccept), statusOf(rLost)]).toEqual([200, 409]);
    const d = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d).toMatchObject({ status: 'WON', acceptedProposalVersionId: a.versionId });
  });
});

describe('project completion and new client work (F2)', () => {
  async function readyDeliverable() {
    const owner = staff('owner');
    const deal = await makeDeal(db, seeded.agencyId, owner.id);
    const org = await makeClientOrg(db, seeded.agencyId, deal.contactId);
    const { projectId } = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: owner.id,
      createdById: owner.id,
      clientOrgId: org.orgId,
    });
    const project = await db.project.update({
      where: { id: projectId },
      data: { state: 'ACTIVE' },
    });
    const file = await db.storedFile.create({
      data: {
        agencyId: seeded.agencyId,
        projectId,
        uploadedById: owner.id,
        storageKey: crypto.randomUUID(),
        originalName: 'logo.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });
    const deliverable = await db.deliverable.create({
      data: {
        agencyId: seeded.agencyId,
        projectId,
        title: 'Logo',
        status: 'READY',
        currentVersionNo: 1,
        createdById: owner.id,
        versions: {
          create: {
            agencyId: seeded.agencyId,
            versionNo: 1,
            fileId: file.id,
            fileSha256: file.sha256,
            createdById: owner.id,
          },
        },
      },
    });
    return { owner, project, deliverable };
  }

  it('completion first: the publish waits, then is refused', async () => {
    const { owner, project, deliverable } = await readyDeliverable();
    const l = await locker();
    await l.lock('SELECT id FROM projects WHERE id = $1 FOR UPDATE', project.id);
    const done = changeProjectState(db, owner, project.id, project.version, 'COMPLETED', 'r1');
    await waitForWaiters(1);
    const publish = publishDeliverable(
      db,
      owner,
      deliverable.id,
      deliverable.version,
      'r2',
      'Africa/Cairo',
    );
    await waitForWaiters(2);
    await l.release();
    const [rDone, rPublish] = await Promise.allSettled([done, publish]);

    expect([statusOf(rDone), statusOf(rPublish)]).toEqual([200, 409]);
    const p = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    const d = await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } });
    expect([p.state, d.status]).toEqual(['COMPLETED', 'READY']);
  });

  it('publish first: completion waits, then sees the open review and is refused', async () => {
    const { owner, project, deliverable } = await readyDeliverable();
    const l = await locker();
    await l.lock('SELECT id FROM projects WHERE id = $1 FOR UPDATE', project.id);
    const publish = publishDeliverable(
      db,
      owner,
      deliverable.id,
      deliverable.version,
      'r1',
      'Africa/Cairo',
    );
    await waitForWaiters(1);
    const done = changeProjectState(db, owner, project.id, project.version, 'COMPLETED', 'r2');
    await waitForWaiters(2);
    await l.release();
    const [rPublish, rDone] = await Promise.allSettled([publish, done]);

    expect([statusOf(rPublish), statusOf(rDone)]).toEqual([200, 409]);
    const p = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    const d = await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } });
    expect([p.state, d.status]).toEqual(['ACTIVE', 'PUBLISHED']);
  });
});

describe('task assignment and member removal (F14)', () => {
  /** Resolves once `p` has settled or `n` transactions wait on a lock, whichever comes first. */
  async function settledOrWaiting(p: Promise<unknown>, n: number) {
    let settled = false;
    void p.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 200 && !settled; i++) {
      const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (Number(row!.n) >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('a member removed while a task is being assigned to them never keeps that task', async () => {
    const pm = staff('pm');
    const memberId = seeded.users.member!.id;
    const { projectId } = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: pm.id,
      createdById: pm.id,
      memberIds: [memberId],
    });
    const task = await db.task.create({
      data: { agencyId: seeded.agencyId, projectId, title: 'Hero banner', createdById: pm.id },
    });
    // Holds the task row, so the assignment stops after its team check, before it writes.
    const l = await locker();
    await l.lock('SELECT id FROM tasks WHERE id = $1 FOR NO KEY UPDATE', task.id);
    const assign = updateTask(
      db,
      pm,
      task.id,
      { version: task.version, assigneeId: memberId } as never,
      'Africa/Cairo',
    );
    await waitForWaiters(1);
    const remove = removeMember(db, pm, projectId, memberId, 'r1');
    // Before the fix the removal finished here, while the assignment was still waiting.
    await settledOrWaiting(remove, 2);
    await l.release();
    const results = await Promise.allSettled([assign, remove]);
    expect(results.map(statusOf)).toEqual([200, 200]);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const stillMember = await db.projectMember.count({ where: { projectId, userId: memberId } });
    expect(stillMember).toBe(0);
    // The removal ran after the assignment and handed the task back, as it does one at a time.
    expect(after.assigneeId).toBeNull();
  });
});

describe('database backstops (F1, F3)', () => {
  it('a deal never has two accepted proposals, whatever writes them', async () => {
    const { proposal } = await dealWithClient();
    const a = await proposal();
    const b = await proposal();
    await db.proposal.update({ where: { id: a.proposalId }, data: { status: 'ACCEPTED' } });
    await expect(
      db.proposal.update({ where: { id: b.proposalId }, data: { status: 'ACCEPTED' } }),
    ).rejects.toThrow(/proposals_one_accepted_per_deal|Unique constraint/);
  });

  it('a won deal names its accepted proposal or an override reason', async () => {
    const { owner, deal } = await dealWithClient();
    const won = { status: 'WON' as const, closedAt: new Date(), closedById: owner.id };
    await expect(db.deal.update({ where: { id: deal.id }, data: won })).rejects.toThrow(
      /deals_won_has_basis/,
    );
    await db.deal.update({
      where: { id: deal.id },
      data: { ...won, wonOverrideReason: 'Signed PO by email' },
    });
  });
});
