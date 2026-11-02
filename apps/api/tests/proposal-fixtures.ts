// Direct-to-database fixtures for proposal tests: a proposal in any workflow state, a client
// organization with a portal user. The API paths that produce these states are tested separately.
import type { Db } from '../src/db/client.js';
import type { ProposalStatus } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/password.js';
import { PASSWORD } from './helpers.js';

export const FIXTURE_HASH = 'a'.repeat(64);

export async function makeDeal(
  db: Db,
  agencyId: string,
  ownerId: string,
  opts: { contactId?: string; title?: string; currency?: string } = {},
) {
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { agencyId },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  const contactId =
    opts.contactId ??
    (await db.contact.create({ data: { agencyId, ownerId, fullName: 'Fixture contact' } })).id;
  return db.deal.create({
    data: {
      agencyId,
      ownerId,
      contactId,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      title: opts.title ?? 'Fixture deal',
      amountMinor: 100_000n,
      currency: opts.currency ?? 'EGP',
    },
  });
}

let counter = 1000;

/** A proposal whose single version (v1) is in `status`, with one line of 2 × 500.00 + 14% VAT. */
export async function makeProposal(
  db: Db,
  opts: {
    agencyId: string;
    dealId: string;
    createdById: string;
    status: ProposalStatus;
    clientOrgId?: string | null;
    expiresOn?: string;
    hash?: string;
    internalNotes?: string;
    milestones?: string;
  },
) {
  const status = opts.status;
  const frozen = status !== 'DRAFT';
  const approved = !['DRAFT', 'IN_REVIEW'].includes(status);
  const sent = ['SENT', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED'].includes(status);
  const now = new Date();
  const proposal = await db.proposal.create({
    data: {
      agencyId: opts.agencyId,
      dealId: opts.dealId,
      number: counter++,
      status,
      createdById: opts.createdById,
      clientOrgId: opts.clientOrgId ?? null,
    },
  });
  // Items first, while the version is still a draft (the immutability trigger allows that).
  const version = await db.proposalVersion.create({
    data: {
      agencyId: opts.agencyId,
      proposalId: proposal.id,
      versionNo: 1,
      title: 'Fixture proposal',
      currency: 'EGP',
      expiresOn: new Date(`${opts.expiresOn ?? '2099-12-31'}T00:00:00Z`),
      internalNotes: opts.internalNotes ?? null,
      milestones: opts.milestones ?? null,
      subtotalMinor: 100_000n,
      taxMinor: 14_000n,
      totalMinor: 114_000n,
      createdById: opts.createdById,
      items: {
        create: {
          position: 0,
          name: 'Design day',
          unit: 'day',
          quantityCenti: 200,
          unitPriceMinor: 50_000n,
          lineTotalMinor: 100_000n,
        },
      },
    },
  });
  if (frozen) {
    await db.proposalVersion.update({
      where: { id: version.id },
      data: {
        status,
        contentHash: opts.hash ?? FIXTURE_HASH,
        submittedAt: now,
        approvedAt: approved ? now : null,
        sentAt: sent ? now : null,
        decidedAt: ['ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED'].includes(status) ? now : null,
      },
    });
  }
  return { proposalId: proposal.id, versionId: version.id };
}

/** A client organization linked to a contact, with one active CLIENT user (password PASSWORD). */
export async function makeClientOrg(
  db: Db,
  agencyId: string,
  contactId: string,
  opts: { name?: string; email?: string } = {},
) {
  const org = await db.clientOrganization.create({
    data: { agencyId, name: opts.name ?? 'Fixture Client Co.' },
  });
  await db.contact.update({ where: { id: contactId }, data: { clientOrgId: org.id } });
  const user = await db.user.create({
    data: {
      agencyId,
      emailNorm: opts.email ?? `client-${org.id.slice(-6)}@client.test`,
      name: 'Client person',
      role: 'CLIENT',
      clientOrgId: org.id,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return { orgId: org.id, clientUserId: user.id, clientEmail: user.emailNorm };
}

/** A project with one milestone and one checklist item, optionally from a won deal. */
export async function makeProject(
  db: Db,
  opts: {
    agencyId: string;
    managerId: string;
    createdById: string;
    title?: string;
    dealId?: string;
    baselineVersionId?: string;
    memberIds?: string[];
    clientOrgId?: string;
  },
) {
  const p = await db.project.create({
    data: {
      agencyId: opts.agencyId,
      title: opts.title ?? 'Fixture project',
      managerId: opts.managerId,
      createdById: opts.createdById,
      dealId: opts.dealId ?? null,
      baselineVersionId: opts.baselineVersionId ?? null,
      clientOrgId: opts.clientOrgId ?? null,
      currency: 'EGP',
      milestones: { create: [{ title: 'Kick-off', sequence: 0 }] },
      checklist: { create: [{ label: 'Kick-off scheduled', sequence: 0 }] },
      members: { create: (opts.memberIds ?? []).map((userId) => ({ userId })) },
    },
    include: { milestones: true, checklist: true },
  });
  return { projectId: p.id, milestoneId: p.milestones[0]!.id, checklistItemId: p.checklist[0]!.id };
}
