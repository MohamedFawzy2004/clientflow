import {
  can,
  parseMoneyToMinor,
  type BoardColumn,
  type Currency,
  type DealBoard,
  type DealCloseInput,
  type DealListQuery,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Deal, Prisma } from '../../generated/prisma/client.js';
import { parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { assertAssignableOwner } from '../../lib/sales-owner.js';
import { actorSelect, recordActivity, toTimelineEntry } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { contactReadScope } from '../contacts/policy.js';
import { escapeLike, UUID_PATTERN } from '../contacts/service.js';
import { getDefaultPipeline } from '../pipelines/service.js';
import { assertCanWriteDeals, dealReadScope } from './policy.js';
import { dealInclude, toDealDetail, toDealSummary } from './serializer.js';

type Tx = Prisma.TransactionClient;
const BOARD_CARDS_PER_STAGE = 100;

function toMinor(amount: string, currency: Currency): bigint {
  const minor = parseMoneyToMinor(amount, currency);
  if (minor === null)
    throw validationFailed({ amount: ['Use a positive number with at most 2 decimals.'] });
  return BigInt(minor);
}

export async function listDeals(db: Db, actor: AuthUser, query: DealListQuery) {
  const filters: Prisma.DealWhereInput[] = [dealReadScope(actor)];
  if (query.status) filters.push({ status: query.status });
  if (query.stageId) filters.push({ stageId: query.stageId });
  if (query.ownerId) filters.push({ ownerId: query.ownerId });
  if (query.contactId) filters.push({ contactId: query.contactId });
  if (query.q) {
    const q = escapeLike(query.q);
    filters.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { contact: { fullName: { contains: q, mode: 'insensitive' } } },
        { contact: { companyName: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  const where: Prisma.DealWhereInput = { AND: filters };
  const [total, rows] = await db.$transaction([
    db.deal.count({ where }),
    db.deal.findMany({
      where,
      include: dealInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return { total, rows: rows.map(toDealSummary) };
}

/** Kanban data: open deals per active stage, with per-currency totals (never summed across currencies). */
export async function getBoard(db: Db, actor: AuthUser): Promise<DealBoard> {
  const scope = dealReadScope(actor);
  const pipeline = await getDefaultPipeline(db, actor.agencyId);
  const where: Prisma.DealWhereInput = {
    AND: [scope, { pipelineId: pipeline.id, status: 'OPEN' }],
  };
  const [groups, deals] = await Promise.all([
    db.deal.groupBy({
      by: ['stageId', 'currency'],
      where,
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    Promise.all(
      pipeline.stages.map((s) =>
        db.deal.findMany({
          where: { AND: [where, { stageId: s.id }] },
          include: dealInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: BOARD_CARDS_PER_STAGE,
        }),
      ),
    ),
  ]);
  const columns: BoardColumn[] = pipeline.stages.map((s, i) => {
    const stageGroups = groups.filter((g) => g.stageId === s.id);
    return {
      id: s.id,
      name: s.name,
      position: s.position,
      deals: deals[i]!.map(toDealSummary),
      count: stageGroups.reduce((n, g) => n + g._count._all, 0),
      totals: Object.fromEntries(
        stageGroups.map((g) => [g.currency, (g._sum.amountMinor ?? 0n).toString()]),
      ),
    };
  });
  return { pipeline: { id: pipeline.id, name: pipeline.name }, columns };
}

async function findReadable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const deal = await db.deal.findFirst({
    where: { AND: [dealReadScope(actor), { id }] },
    include: {
      ...dealInclude,
      closedBy: { select: { id: true, name: true } },
      acceptedProposalVersion: {
        select: { versionNo: true, proposal: { select: { id: true, number: true } } },
      },
    },
  });
  if (!deal) throw notFound();
  return deal;
}

export async function getDeal(db: Db, actor: AuthUser, id: string) {
  const deal = await findReadable(db, actor, id);
  const activities = await db.activity.findMany({
    where: { agencyId: actor.agencyId, entityType: 'deal', entityId: deal.id },
    include: actorSelect,
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });
  return toDealDetail(deal, activities.map(toTimelineEntry));
}

/** Records the same event on the deal and on its contact, so the contact history stays continuous. */
async function recordOnBoth(
  tx: Tx,
  actor: AuthUser,
  deal: Pick<Deal, 'id' | 'contactId'>,
  eventType: string,
  summary: string,
  body?: string,
) {
  await recordActivity(tx, actor, {
    entityType: 'deal',
    entityId: deal.id,
    eventType,
    summary,
    body: body ?? null,
  });
  await recordActivity(tx, actor, {
    entityType: 'contact',
    entityId: deal.contactId,
    eventType,
    summary,
    body: body ?? null,
  });
}

export async function createDeal(
  db: Db,
  actor: AuthUser,
  input: {
    contactId: string;
    title: string;
    amount: string;
    currency: Currency;
    stageId?: string | undefined;
    expectedCloseOn?: string | undefined;
    nextStep?: string | undefined;
    nextStepAt?: string | undefined;
  },
  requestId: string,
) {
  assertCanWriteDeals(actor);
  const amountMinor = toMinor(input.amount, input.currency);
  const id = await db.$transaction(async (tx) => {
    // The contact must be visible to the actor: a deal cannot be attached to a hidden record.
    const contact = await tx.contact.findFirst({
      where: { AND: [contactReadScope(actor), { id: input.contactId }] },
    });
    if (!contact) throw validationFailed({ contactId: ['Choose a lead from your list.'] });
    const pipeline = await getDefaultPipeline(tx, actor.agencyId);
    const stage = input.stageId
      ? pipeline.stages.find((s) => s.id === input.stageId)
      : pipeline.stages[0];
    if (!stage) throw validationFailed({ stageId: ['Choose a stage from the pipeline.'] });

    const deal = await tx.deal.create({
      data: {
        agencyId: actor.agencyId,
        contactId: contact.id,
        ownerId: actor.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: input.title,
        amountMinor,
        currency: input.currency,
        expectedCloseOn: input.expectedCloseOn ? parseDateOnly(input.expectedCloseOn) : null,
        nextStep: input.nextStep ?? null,
        nextStepAt: input.nextStepAt ? new Date(input.nextStepAt) : null,
      },
    });
    await recordOnBoth(
      tx,
      actor,
      deal,
      'deal.created',
      `Deal “${deal.title}” created by ${actor.name} in ${stage.name}`,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deal.create',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
    });
    return deal.id;
  });
  return getDeal(db, actor, id);
}

/** Loads a deal the actor may change. Closed deals are read-only until reopened (spec §9). */
async function loadWritable(
  tx: Tx,
  actor: AuthUser,
  id: string,
  options: { allowClosed?: boolean } = {},
) {
  assertCanWriteDeals(actor);
  const deal = await findReadable(tx, actor, id);
  if (deal.status !== 'OPEN' && !options.allowClosed) {
    throw conflict(
      `This deal is ${deal.status === 'WON' ? 'won' : 'lost'}. Reopen it before changing it.`,
    );
  }
  return deal;
}

async function updateVersioned(
  tx: Tx,
  deal: Deal,
  expected: number,
  data: Prisma.DealUncheckedUpdateManyInput,
  extraWhere: Prisma.DealWhereInput = {},
) {
  if (deal.version !== expected) throw staleVersion();
  const res = await tx.deal.updateMany({
    where: { id: deal.id, version: expected, ...extraWhere },
    data: { ...data, version: { increment: 1 } },
  });
  return res.count;
}

export async function updateDeal(
  db: Db,
  actor: AuthUser,
  id: string,
  input: {
    version: number;
    title?: string | undefined;
    amount?: string | undefined;
    currency?: Currency | undefined;
    expectedCloseOn?: string | null | undefined;
    nextStep?: string | null | undefined;
    nextStepAt?: string | null | undefined;
  },
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const deal = await loadWritable(tx, actor, id);
    const data: Prisma.DealUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    if (input.title !== undefined) {
      data.title = input.title;
      changed.push('name');
    }
    if (input.amount !== undefined) {
      const currency = input.currency ?? (deal.currency as Currency);
      data.amountMinor = toMinor(input.amount, currency);
      data.currency = currency;
      changed.push('amount');
    }
    if (input.expectedCloseOn !== undefined) {
      data.expectedCloseOn =
        input.expectedCloseOn === null ? null : parseDateOnly(input.expectedCloseOn);
      changed.push('expected close');
    }
    if (input.nextStep !== undefined) {
      data.nextStep = input.nextStep;
      changed.push('next step');
    }
    if (input.nextStepAt !== undefined) {
      data.nextStepAt = input.nextStepAt === null ? null : new Date(input.nextStepAt);
      if (!changed.includes('next step')) changed.push('next step');
    }
    if (changed.length === 0) {
      if (deal.version !== input.version) throw staleVersion();
      return;
    }
    if ((await updateVersioned(tx, deal, input.version, data)) === 0) throw staleVersion();
    await recordActivity(tx, actor, {
      entityType: 'deal',
      entityId: deal.id,
      eventType: 'deal.updated',
      summary: `${actor.name} updated ${changed.join(', ')}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deal.update',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
      metadata: { fields: changed.join(',') },
    });
  });
  return getDeal(db, actor, id);
}

/** Stage move with optimistic locking: two people moving the same card → one 409 (FR-D04). */
export async function moveDeal(
  db: Db,
  actor: AuthUser,
  id: string,
  stageId: string,
  version: number,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const deal = await loadWritable(tx, actor, id);
    const pipeline = await getDefaultPipeline(tx, actor.agencyId);
    const target = pipeline.stages.find((s) => s.id === stageId);
    if (!target || deal.pipelineId !== pipeline.id)
      throw validationFailed({ stageId: ['Choose a stage from the pipeline.'] });
    if (deal.stageId === target.id) {
      if (deal.version !== version) throw staleVersion();
      return;
    }
    if (
      (await updateVersioned(tx, deal, version, { stageId: target.id }, { status: 'OPEN' })) === 0
    )
      throw staleVersion();
    await recordActivity(tx, actor, {
      entityType: 'deal',
      entityId: deal.id,
      eventType: 'deal.stage_changed',
      summary: `Moved from ${deal.stage.name} to ${target.name} by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deal.move',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
      metadata: { fromStageId: deal.stageId, toStageId: target.id },
    });
  });
  return getDeal(db, actor, id);
}

/**
 * Closes a deal (FR-D05, FR-D06).
 * - LOST needs a reason (schema). WON needs an accepted proposal (M4) or, until then, a written
 *   override by someone with `deals.override_won`.
 * - Repeating the same close is a no-op that returns the current deal: one event, ever.
 *   The update is conditional on status OPEN, so a double click cannot close twice.
 * - A WON deal turns its lead into a customer in the same transaction (FR-C07).
 */
export async function closeDeal(
  db: Db,
  actor: AuthUser,
  id: string,
  input: DealCloseInput,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    assertCanWriteDeals(actor);
    const deal = await findReadable(tx, actor, id);
    if (deal.status === input.outcome) return; // idempotent repeat
    if (deal.status !== 'OPEN') throw conflict('This deal is already closed. Reopen it first.');

    if (input.outcome === 'WON') {
      if (!can(actor.role, 'deals.override_won')) {
        throw forbidden(
          'A deal is won when the client accepts a proposal, or by a sales manager’s documented override.',
        );
      }
      if (!input.overrideReason) {
        throw validationFailed({
          overrideReason: ['Explain why this deal is won without a client-accepted proposal.'],
        });
      }
    }
    const now = new Date();
    const data: Prisma.DealUncheckedUpdateManyInput =
      input.outcome === 'WON'
        ? {
            status: 'WON',
            closedAt: now,
            closedById: actor.id,
            wonOverrideReason: input.overrideReason ?? null,
          }
        : { status: 'LOST', closedAt: now, closedById: actor.id, lostReason: input.reason };
    if (deal.version !== input.version) throw staleVersion();
    const count = await updateVersioned(tx, deal, input.version, data, { status: 'OPEN' });
    if (count === 0) {
      // Lost a race: if the winner made the same decision, answer as an idempotent repeat.
      const now2 = await tx.deal.findUniqueOrThrow({ where: { id: deal.id } });
      if (now2.status === input.outcome) return;
      throw staleVersion();
    }

    const why = input.outcome === 'WON' ? input.overrideReason : input.reason;
    await recordOnBoth(
      tx,
      actor,
      deal,
      input.outcome === 'WON' ? 'deal.won' : 'deal.lost',
      `Deal “${deal.title}” marked ${input.outcome === 'WON' ? 'won (manager override)' : 'lost'} by ${actor.name}`,
      why,
    );
    if (input.outcome === 'WON') {
      const converted = await tx.contact.updateMany({
        where: { id: deal.contactId, lifecycle: 'LEAD' },
        data: { lifecycle: 'CUSTOMER', convertedAt: now, version: { increment: 1 } },
      });
      if (converted.count > 0) {
        await recordActivity(tx, actor, {
          entityType: 'contact',
          entityId: deal.contactId,
          eventType: 'contact.converted',
          summary: `Became a customer when “${deal.title}” was won`,
        });
      }
    }
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: input.outcome === 'WON' ? 'deal.won' : 'deal.lost',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
      metadata: { override: input.outcome === 'WON' },
    });
  });
  return getDeal(db, actor, id);
}

/** Reopening is a controlled manager action with a reason (spec §9 "reopening controlled"). */
export async function reopenDeal(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  reason: string,
  requestId: string,
) {
  if (!can(actor.role, 'deals.reopen')) throw forbidden('Only managers can reopen deals.');
  await db.$transaction(async (tx) => {
    const deal = await loadWritable(tx, actor, id, { allowClosed: true });
    if (deal.status === 'OPEN') {
      if (deal.version !== version) throw staleVersion();
      return;
    }
    const count = await updateVersioned(tx, deal, version, {
      status: 'OPEN',
      closedAt: null,
      closedById: null,
      lostReason: null,
      wonOverrideReason: null,
    });
    if (count === 0) throw staleVersion();
    await recordOnBoth(
      tx,
      actor,
      deal,
      'deal.reopened',
      `Deal “${deal.title}” reopened by ${actor.name}`,
      reason,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deal.reopen',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
      metadata: { previousStatus: deal.status },
    });
  });
  return getDeal(db, actor, id);
}

export async function reassignDeal(
  db: Db,
  actor: AuthUser,
  id: string,
  ownerId: string,
  version: number,
  requestId: string,
) {
  if (!can(actor.role, 'sales.reassign')) throw forbidden('Only managers can reassign deals.');
  await db.$transaction(async (tx) => {
    const deal = await loadWritable(tx, actor, id);
    const newOwner = await assertAssignableOwner(tx, actor.agencyId, ownerId);
    if (deal.ownerId === newOwner.id) {
      if (deal.version !== version) throw staleVersion();
      return;
    }
    if ((await updateVersioned(tx, deal, version, { ownerId: newOwner.id })) === 0)
      throw staleVersion();
    await recordActivity(tx, actor, {
      entityType: 'deal',
      entityId: deal.id,
      eventType: 'deal.reassigned',
      summary: `Owner changed from ${deal.owner.name} to ${newOwner.name} by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deal.reassign',
      outcome: 'SUCCESS',
      targetType: 'deal',
      targetId: deal.id,
      requestId,
      metadata: { fromUserId: deal.ownerId, toUserId: newOwner.id },
    });
  });
  return getDeal(db, actor, id);
}
