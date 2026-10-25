// Role × endpoint negative test matrix (SEC-01, SEC-02, FR-I11). The expected table is written
// by hand from spec §1.1 on purpose: it must not be derived from the implementation's matrix.
// Every new endpoint must be added here.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Role } from '@clientflow/contracts';
import { hashPassword } from '../src/lib/password.js';
import {
  login,
  makeApp,
  ORIGIN,
  PASSWORD,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { randomUUID } from 'node:crypto';
import {
  FIXTURE_HASH,
  makeClientOrg,
  makeDeal,
  makeProject,
  makeProposal,
} from './proposal-fixtures.js';

const db = testDb();
afterAll(() => db.$disconnect());

/** One fresh record per mutating endpoint, so one call's version bump cannot affect another. */
interface Fixtures {
  userPatch: string;
  userDeactivate: string;
  userRevoke: string;
  contactRead: string;
  contactPatch: string;
  contactConvert: string;
  contactArchive: string;
  contactReassign: string;
  contactActivity: string;
  dealPatch: string;
  dealMove: string;
  dealLose: string;
  dealWin: string;
  dealReopen: string;
  dealReassign: string;
  stageId: string;
  salesB: string;
  servicePatch: string;
  serviceArchive: string;
  proposalDeal: string;
  proposalRead: string;
  proposalDraft: string;
  proposalSubmit: string;
  proposalReview: string;
  proposalSend: string;
  proposalRevise: string;
  orgContact: string;
  orgId: string;
  orgInvitation: string;
  orgUserToDeactivate: string;
  portalProposal: string;
  clientEmail: string;
  projRead: string;
  projPatch: string;
  projState: string;
  projMembers: string;
  projRemove: string;
  projMilestones: string;
  projMilestonePatch: { projectId: string; milestoneId: string };
  projChecklist: { projectId: string; itemId: string };
  convertDeal: string;
  pmId: string;
  memberId: string;
}

interface Endpoint {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put';
  path: (f: Fixtures) => string;
  body?: (role: Role, f: Fixtures) => object;
  headers?: () => Record<string, string>;
  allowed: Role[];
}

const STAFF: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE'];
const SALES_SIDE: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'];
const SALES_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER'];
const TEAM_ADMINS: Role[] = ['OWNER', 'ADMIN'];
const CLIENT_ONLY: Role[] = ['CLIENT'];
const PROJECT_READERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER'];
const PROJECT_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'PM'];
const EVERYONE: Role[] = [...STAFF, 'CLIENT'];

const ENDPOINTS: Endpoint[] = [
  { name: 'GET /auth/me', method: 'get', path: () => '/api/v1/auth/me', allowed: EVERYONE },
  // Contacts
  { name: 'GET /contacts', method: 'get', path: () => '/api/v1/contacts', allowed: SALES_SIDE },
  {
    name: 'GET /contacts/:id',
    method: 'get',
    path: (f) => `/api/v1/contacts/${f.contactRead}`,
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts',
    method: 'post',
    path: () => '/api/v1/contacts',
    body: (r) => ({ fullName: `Lead by ${r}` }),
    allowed: SALES_SIDE,
  },
  {
    name: 'PATCH /contacts/:id',
    method: 'patch',
    path: (f) => `/api/v1/contacts/${f.contactPatch}`,
    body: () => ({ version: 1, companyName: 'Changed' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/convert',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactConvert}/convert`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/archive',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactArchive}/archive`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/activities',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactActivity}/activities`,
    body: () => ({ kind: 'NOTE', body: 'Matrix note' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/reassign',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactReassign}/reassign`,
    body: (_r, f) => ({ ownerId: f.salesB, version: 1 }),
    allowed: SALES_MANAGERS,
  },
  // Deals and pipeline
  {
    name: 'GET /pipelines/default',
    method: 'get',
    path: () => '/api/v1/pipelines/default',
    allowed: SALES_SIDE,
  },
  { name: 'GET /deals', method: 'get', path: () => '/api/v1/deals', allowed: SALES_SIDE },
  {
    name: 'GET /deals/board',
    method: 'get',
    path: () => '/api/v1/deals/board',
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals',
    method: 'post',
    path: () => '/api/v1/deals',
    body: (_r, f) => ({
      contactId: f.contactRead,
      title: 'Matrix deal',
      amount: '100',
      currency: 'EGP',
    }),
    allowed: SALES_SIDE,
  },
  {
    name: 'PATCH /deals/:id',
    method: 'patch',
    path: (f) => `/api/v1/deals/${f.dealPatch}`,
    body: () => ({ version: 1, title: 'Changed' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/move',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealMove}/move`,
    body: (_r, f) => ({ stageId: f.stageId, version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/close (LOST)',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealLose}/close`,
    body: () => ({ outcome: 'LOST', version: 1, reason: 'Matrix test' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/close (WON override)',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealWin}/close`,
    body: () => ({ outcome: 'WON', version: 1, overrideReason: 'Matrix test' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /deals/:id/reopen',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealReopen}/reopen`,
    body: () => ({ version: 1, reason: 'Matrix test' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /deals/:id/reassign',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealReassign}/reassign`,
    body: (_r, f) => ({ ownerId: f.salesB, version: 1 }),
    allowed: SALES_MANAGERS,
  },
  { name: 'GET /follow-ups', method: 'get', path: () => '/api/v1/follow-ups', allowed: SALES_SIDE },
  {
    name: 'GET /sales/assignable-owners',
    method: 'get',
    path: () => '/api/v1/sales/assignable-owners',
    allowed: SALES_MANAGERS,
  },
  // Team
  { name: 'GET /users', method: 'get', path: () => '/api/v1/users', allowed: TEAM_ADMINS },
  {
    name: 'PATCH /users/:id',
    method: 'patch',
    path: (f) => `/api/v1/users/${f.userPatch}`,
    body: () => ({ role: 'PM', version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/deactivate',
    method: 'post',
    path: (f) => `/api/v1/users/${f.userDeactivate}/deactivate`,
    body: () => ({ version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/revoke-sessions',
    method: 'post',
    path: (f) => `/api/v1/users/${f.userRevoke}/revoke-sessions`,
    allowed: TEAM_ADMINS,
  },
  {
    name: 'GET /invitations',
    method: 'get',
    path: () => '/api/v1/invitations',
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /invitations',
    method: 'post',
    path: () => '/api/v1/invitations',
    body: (r) => ({ email: `invitee-${r.toLowerCase()}@agency.test`, role: 'SALES' }),
    allowed: TEAM_ADMINS,
  },
  // Service catalog (M4)
  { name: 'GET /services', method: 'get', path: () => '/api/v1/services', allowed: SALES_SIDE },
  {
    name: 'POST /services',
    method: 'post',
    path: () => '/api/v1/services',
    body: () => ({ name: 'Matrix service', unit: 'hour', rate: '100', currency: 'EGP' }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'PATCH /services/:id',
    method: 'patch',
    path: (f) => `/api/v1/services/${f.servicePatch}`,
    body: () => ({ version: 1, name: 'Changed' }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /services/:id/archive',
    method: 'post',
    path: (f) => `/api/v1/services/${f.serviceArchive}/archive`,
    body: () => ({ version: 1 }),
    allowed: TEAM_ADMINS,
  },
  // Proposals (M4)
  { name: 'GET /proposals', method: 'get', path: () => '/api/v1/proposals', allowed: SALES_SIDE },
  {
    name: 'POST /proposals',
    method: 'post',
    path: () => '/api/v1/proposals',
    body: (_r, f) => ({ dealId: f.proposalDeal }),
    allowed: SALES_SIDE,
  },
  {
    name: 'GET /proposals/:id',
    method: 'get',
    path: (f) => `/api/v1/proposals/${f.proposalRead}`,
    allowed: SALES_SIDE,
  },
  {
    name: 'GET /proposals/:id/versions/:no',
    method: 'get',
    path: (f) => `/api/v1/proposals/${f.proposalRead}/versions/1`,
    allowed: SALES_SIDE,
  },
  {
    name: 'PUT /proposals/:id/draft',
    method: 'put',
    path: (f) => `/api/v1/proposals/${f.proposalDraft}/draft`,
    body: () => ({
      version: 1,
      title: 'Matrix proposal',
      expiresOn: '2099-01-31',
      discountPercent: '0',
      taxRatePercent: '14',
      taxLabel: 'VAT',
      items: [{ name: 'Day', unit: 'day', quantity: '1', unitPrice: '100' }],
    }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /proposals/:id/submit',
    method: 'post',
    path: (f) => `/api/v1/proposals/${f.proposalSubmit}/submit`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /proposals/:id/review',
    method: 'post',
    path: (f) => `/api/v1/proposals/${f.proposalReview}/review`,
    body: () => ({ version: 1, decision: 'APPROVE' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /proposals/:id/send',
    method: 'post',
    path: (f) => `/api/v1/proposals/${f.proposalSend}/send`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /proposals/:id/revise',
    method: 'post',
    path: (f) => `/api/v1/proposals/${f.proposalRevise}/revise`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  // Client organizations and portal access (M4)
  {
    name: 'POST /contacts/:id/client-org',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.orgContact}/client-org`,
    body: () => ({ name: 'Matrix Client Org' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'GET /client-orgs/:id',
    method: 'get',
    path: (f) => `/api/v1/client-orgs/${f.orgId}`,
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /client-orgs/:id/invitations',
    method: 'post',
    path: (f) => `/api/v1/client-orgs/${f.orgId}/invitations`,
    body: (r) => ({ email: `portal-${r.toLowerCase()}@client.test` }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /client-orgs/:id/invitations/:id/revoke',
    method: 'post',
    path: (f) => `/api/v1/client-orgs/${f.orgId}/invitations/${f.orgInvitation}/revoke`,
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /client-orgs/:id/users/:id/deactivate',
    method: 'post',
    path: (f) => `/api/v1/client-orgs/${f.orgId}/users/${f.orgUserToDeactivate}/deactivate`,
    body: () => ({ version: 1 }),
    allowed: SALES_MANAGERS,
  },
  // Dashboard, reminders, exports, agency settings, PDFs (M5)
  {
    name: 'GET /dashboard/sales',
    method: 'get',
    path: () => '/api/v1/dashboard/sales',
    allowed: SALES_SIDE,
  },
  { name: 'GET /reminders', method: 'get', path: () => '/api/v1/reminders', allowed: SALES_SIDE },
  {
    name: 'GET /exports/deals.csv',
    method: 'get',
    path: () => '/api/v1/exports/deals.csv',
    allowed: SALES_MANAGERS,
  },
  { name: 'GET /agency', method: 'get', path: () => '/api/v1/agency', allowed: TEAM_ADMINS },
  {
    name: 'PATCH /agency',
    method: 'patch',
    path: () => '/api/v1/agency',
    body: () => ({
      version: 1,
      name: 'Test Agency',
      defaultCurrency: 'EGP',
      timeZone: 'Africa/Cairo',
      workingDays: [0, 1, 2, 3, 4],
    }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'GET /proposals/:id/versions/:no/pdf',
    method: 'get',
    path: (f) => `/api/v1/proposals/${f.proposalReview}/versions/1/pdf`,
    allowed: SALES_SIDE,
  },
  {
    name: 'GET /portal/proposals/:id/pdf',
    method: 'get',
    path: (f) => `/api/v1/portal/proposals/${f.portalProposal}/pdf`,
    allowed: CLIENT_ONLY,
  },
  // Projects (M6)
  {
    name: 'GET /projects',
    method: 'get',
    path: () => '/api/v1/projects',
    allowed: PROJECT_READERS,
  },
  {
    name: 'GET /projects/:id',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.projRead}`,
    allowed: PROJECT_READERS,
  },
  {
    name: 'POST /projects',
    method: 'post',
    path: () => '/api/v1/projects',
    body: (_r, f) => ({ title: 'Matrix project', managerId: f.pmId, currency: 'EGP' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'PATCH /projects/:id',
    method: 'patch',
    path: (f) => `/api/v1/projects/${f.projPatch}`,
    body: () => ({ version: 1, title: 'Changed' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/state',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.projState}/state`,
    body: () => ({ version: 1, state: 'ACTIVE' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/members',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.projMembers}/members`,
    body: (_r, f) => ({ userId: f.memberId }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/members/:userId/remove',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.projRemove}/members/${f.memberId}/remove`,
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/milestones',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.projMilestones}/milestones`,
    body: () => ({ title: 'Matrix milestone' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'PATCH /projects/:id/milestones/:id',
    method: 'patch',
    path: (f) =>
      `/api/v1/projects/${f.projMilestonePatch.projectId}/milestones/${f.projMilestonePatch.milestoneId}`,
    body: () => ({ version: 1, status: 'DONE' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/checklist/:id',
    method: 'post',
    path: (f) =>
      `/api/v1/projects/${f.projChecklist.projectId}/checklist/${f.projChecklist.itemId}`,
    body: () => ({ done: true }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /projects/handoff-queue',
    method: 'get',
    path: () => '/api/v1/projects/handoff-queue',
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /deals/:id/convert-to-project',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.convertDeal}/convert-to-project`,
    headers: () => ({ 'Idempotency-Key': randomUUID() }),
    body: (_r, f) => ({ managerId: f.pmId }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /dashboard/delivery',
    method: 'get',
    path: () => '/api/v1/dashboard/delivery',
    allowed: ['OWNER', 'ADMIN', 'PM', 'MEMBER'],
  },
  // Client portal (M4)
  {
    name: 'GET /portal/proposals',
    method: 'get',
    path: () => '/api/v1/portal/proposals',
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/proposals/:id',
    method: 'get',
    path: (f) => `/api/v1/portal/proposals/${f.portalProposal}`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/proposals/:id/decision',
    method: 'post',
    path: (f) => `/api/v1/portal/proposals/${f.portalProposal}/decision`,
    body: () => ({
      decision: 'REQUEST_CHANGES',
      contentHash: FIXTURE_HASH,
      comment: 'Matrix decision',
    }),
    allowed: CLIENT_ONLY,
  },
];

const KEY_FOR_ROLE: Record<string, string> = {
  OWNER: 'owner',
  ADMIN: 'admin',
  SALES_MANAGER: 'manager',
  SALES: 'salesA',
  PM: 'pm',
  MEMBER: 'member',
  FINANCE: 'finance',
};

/** Sales records are owned by salesA, so SALES (salesA) is in scope and managers see them too. */
async function freshFixtures(seeded: SeededAgency): Promise<Fixtures> {
  const { agencyId } = seeded;
  const ownerId = seeded.users.salesA!.id;
  const passwordHash = await hashPassword(PASSWORD);
  const user = (n: string) =>
    db.user.create({
      data: { agencyId, emailNorm: `${n}@targets.test`, name: n, role: 'MEMBER', passwordHash },
    });
  const contact = (n: string) => db.contact.create({ data: { agencyId, ownerId, fullName: n } });
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { agencyId },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  const base = {
    agencyId,
    ownerId,
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
    amountMinor: 1000n,
    currency: 'EGP',
  };
  const dealContact = await contact('Deal holder');
  const deal = (title: string, extra: object = {}) =>
    db.deal.create({ data: { ...base, contactId: dealContact.id, title, ...extra } });

  const [userPatch, userDeactivate, userRevoke] = await Promise.all([
    user('patch-target'),
    user('deactivate-target'),
    user('revoke-target'),
  ]);
  const [
    contactRead,
    contactPatch,
    contactConvert,
    contactArchive,
    contactReassign,
    contactActivity,
  ] = await Promise.all(
    ['read', 'patch', 'convert', 'archive', 'reassign', 'activity'].map((n) =>
      contact(`Contact ${n}`),
    ),
  );
  const [dealPatch, dealMove, dealLose, dealWin, dealReassign] = await Promise.all(
    ['patch', 'move', 'lose', 'win', 'reassign'].map((n) => deal(`Deal ${n}`)),
  );
  const dealReopen = await deal('Deal reopen', {
    status: 'LOST',
    closedAt: new Date(),
    closedById: ownerId,
    lostReason: 'Fixture',
  });
  // M4 fixtures. Every proposal lives on salesA's deals, so SALES is in scope.
  const svc = (n: string) =>
    db.serviceItem.create({
      data: { agencyId, name: n, unit: 'hour', rateMinor: 10_000n, currency: 'EGP' },
    });
  const [servicePatch, serviceArchive] = await Promise.all([svc('patch'), svc('archive')]);
  const pdeal = () => makeDeal(db, agencyId, ownerId);
  const proposal = async (
    status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED_INTERNAL' | 'SENT',
    orgId?: string,
    dealId?: string,
  ) =>
    (
      await makeProposal(db, {
        agencyId,
        dealId: dealId ?? (await pdeal()).id,
        createdById: ownerId,
        status,
        clientOrgId: orgId ?? null,
      })
    ).proposalId;
  // The send fixture's contact has a portal; the decision fixture belongs to the CLIENT login.
  const sendDeal = await pdeal();
  const sendOrg = await makeClientOrg(db, agencyId, sendDeal.contactId, {
    email: 'send-org@client.test',
  });
  const portalDeal = await pdeal();
  const portal = await makeClientOrg(db, agencyId, portalDeal.contactId, {
    email: 'portal-login@client.test',
  });
  const extraClient = await db.user.create({
    data: {
      agencyId,
      emailNorm: 'deactivate-me@client.test',
      name: 'Deactivate me',
      role: 'CLIENT',
      clientOrgId: sendOrg.orgId,
      passwordHash,
    },
  });
  const orgInvitation = await db.invitation.create({
    data: {
      agencyId,
      emailNorm: 'pending@client.test',
      role: 'CLIENT',
      clientOrgId: sendOrg.orgId,
      tokenHash: 'f'.repeat(64),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: ownerId,
    },
  });
  const orgContact = await contact('Org contact');

  const pmId = seeded.users.pm!.id;
  const memberId = seeded.users.member!.id;
  const won = async () => {
    const d = await pdeal();
    const { versionId } = await makeProposal(db, {
      agencyId,
      dealId: d.id,
      createdById: ownerId,
      status: 'ACCEPTED',
    });
    await db.deal.update({
      where: { id: d.id },
      data: {
        status: 'WON',
        closedAt: new Date(),
        closedById: ownerId,
        acceptedProposalVersionId: versionId,
      },
    });
    return { dealId: d.id, versionId };
  };
  const readDeal = await won();
  const proj = (extra: object = {}) =>
    makeProject(db, { agencyId, managerId: pmId, createdById: pmId, ...extra });
  const projRead = await proj({
    dealId: readDeal.dealId,
    baselineVersionId: readDeal.versionId,
    memberIds: [memberId],
  });
  const [projPatch, projState, projMembers, projRemove, projMilestones, projMs, projCl] =
    await Promise.all([
      proj(),
      proj(),
      proj(),
      proj({ memberIds: [memberId] }),
      proj(),
      proj(),
      proj(),
    ]);
  const convertDeal = (await won()).dealId;

  return {
    projRead: projRead.projectId,
    projPatch: projPatch.projectId,
    projState: projState.projectId,
    projMembers: projMembers.projectId,
    projRemove: projRemove.projectId,
    projMilestones: projMilestones.projectId,
    projMilestonePatch: { projectId: projMs.projectId, milestoneId: projMs.milestoneId },
    projChecklist: { projectId: projCl.projectId, itemId: projCl.checklistItemId },
    convertDeal,
    pmId,
    memberId,
    servicePatch: servicePatch.id,
    serviceArchive: serviceArchive.id,
    proposalDeal: (await pdeal()).id,
    proposalRead: await proposal('DRAFT'),
    proposalDraft: await proposal('DRAFT'),
    proposalSubmit: await proposal('DRAFT'),
    proposalReview: await proposal('IN_REVIEW'),
    proposalSend: await proposal('APPROVED_INTERNAL', undefined, sendDeal.id),
    proposalRevise: await proposal('SENT', sendOrg.orgId),
    orgContact: orgContact.id,
    orgId: sendOrg.orgId,
    orgInvitation: orgInvitation.id,
    orgUserToDeactivate: extraClient.id,
    portalProposal: await proposal('SENT', portal.orgId, portalDeal.id),
    clientEmail: portal.clientEmail,
    userPatch: userPatch.id,
    userDeactivate: userDeactivate.id,
    userRevoke: userRevoke.id,
    contactRead: contactRead!.id,
    contactPatch: contactPatch!.id,
    contactConvert: contactConvert!.id,
    contactArchive: contactArchive!.id,
    contactReassign: contactReassign!.id,
    contactActivity: contactActivity!.id,
    dealPatch: dealPatch!.id,
    dealMove: dealMove!.id,
    dealLose: dealLose!.id,
    dealWin: dealWin!.id,
    dealReopen: dealReopen.id,
    dealReassign: dealReassign!.id,
    stageId: pipeline.stages[2]!.id,
    salesB: seeded.users.salesB!.id,
  };
}

describe('role × endpoint matrix', () => {
  it.each(EVERYONE)('%s gets exactly the access spec §1.1 grants', async (role) => {
    await resetDb();
    const seeded = await seedAgency();
    const f = await freshFixtures(seeded);
    const { app } = makeApp();
    const email = role === 'CLIENT' ? f.clientEmail : seeded.users[KEY_FOR_ROLE[role]!]!.email;
    const { agent, csrf } = await login(app, email);

    const before = {
      contacts: await db.contact.findMany({ select: { id: true, version: true, ownerId: true } }),
      deals: await db.deal.findMany({
        select: { id: true, version: true, status: true, ownerId: true },
      }),
    };

    const outcomes: Record<string, number> = {};
    for (const ep of ENDPOINTS) {
      let req = agent[ep.method](ep.path(f)).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
      for (const [k, v] of Object.entries(ep.headers?.() ?? {})) req = req.set(k, v);
      if (ep.body) req = req.send(ep.body(role, f));
      const res = await req;
      outcomes[ep.name] = res.status;
    }

    const expected = Object.fromEntries(
      ENDPOINTS.map((ep) => [ep.name, ep.allowed.includes(role) ? 'allowed' : 'forbidden']),
    );
    const actual = Object.fromEntries(
      Object.entries(outcomes).map(([name, status]) => [
        name,
        status === 403
          ? 'forbidden'
          : status >= 200 && status < 300
            ? 'allowed'
            : `unexpected ${status}`,
      ]),
    );
    expect(actual).toEqual(expected);

    // Denied mutations changed nothing.
    if (!SALES_SIDE.includes(role)) {
      expect(
        await db.contact.findMany({ select: { id: true, version: true, ownerId: true } }),
      ).toEqual(before.contacts);
      expect(
        await db.deal.findMany({
          select: { id: true, version: true, status: true, ownerId: true },
        }),
      ).toEqual(before.deals);
      expect(await db.activity.count({ where: { body: 'Matrix note' } })).toBe(0);
    }
    if (role === 'SALES') {
      // SALES may edit, but never reassign, win by override or reopen.
      const reassigned = await db.contact.findUniqueOrThrow({ where: { id: f.contactReassign } });
      expect(reassigned.ownerId).toBe(seeded.users.salesA!.id);
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealWin } })).status).toBe('OPEN');
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealReopen } })).status).toBe(
        'LOST',
      );
    }
    if (!TEAM_ADMINS.includes(role)) {
      expect(await db.invitation.count({ where: { role: { not: 'CLIENT' } } })).toBe(0);
      const t = await db.user.findMany({
        where: { id: { in: [f.userPatch, f.userDeactivate, f.userRevoke] } },
      });
      expect(t.every((u) => u.role === 'MEMBER' && u.active && u.version === 1)).toBe(true);
    }
    if (!SALES_SIDE.includes(role)) {
      // Denied proposal, catalog and portal-setup calls left everything as it was.
      expect(await db.proposal.count()).toBe(9);
      expect(
        await db.proposalVersion.count({
          where: { status: { in: ['IN_REVIEW', 'APPROVED_INTERNAL'] } },
        }),
      ).toBe(2);
      expect(await db.serviceItem.count({ where: { version: 1, archivedAt: null } })).toBe(2);
      expect(await db.clientOrganization.count()).toBe(2);
      expect(await db.user.count({ where: { role: 'CLIENT', active: true } })).toBe(3);
    }
    if (!PROJECT_MANAGERS.includes(role)) {
      expect(await db.project.count()).toBe(8);
      expect(await db.project.count({ where: { version: { gt: 1 } } })).toBe(0);
      expect(await db.projectMilestone.count({ where: { status: { not: 'PLANNED' } } })).toBe(0);
      expect(await db.handoffChecklistItem.count({ where: { doneAt: { not: null } } })).toBe(0);
      expect(await db.projectMember.count()).toBe(2);
    }
    if (role === 'SALES') {
      // SALES drafts and sends, but never approves or manages portal access.
      expect(
        (await db.proposalVersion.findFirstOrThrow({ where: { proposalId: f.proposalReview } }))
          .status,
      ).toBe('IN_REVIEW');
      expect(await db.invitation.count({ where: { role: 'CLIENT', revokedAt: null } })).toBe(1);
    }
  });

  it('signed-out requests get 401 on every protected endpoint', async () => {
    await resetDb();
    const seeded = await seedAgency();
    const f = await freshFixtures(seeded);
    const { app } = makeApp();
    for (const ep of ENDPOINTS) {
      let req = request(app)[ep.method](ep.path(f)).set('Origin', ORIGIN);
      for (const [k, v] of Object.entries(ep.headers?.() ?? {})) req = req.set(k, v);
      if (ep.body) req = req.send(ep.body('OWNER', f));
      const res = await req;
      expect({ ep: ep.name, status: res.status }).toEqual({ ep: ep.name, status: 401 });
    }
  });
});
