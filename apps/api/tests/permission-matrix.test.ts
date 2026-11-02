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
import { createHash, randomUUID } from 'node:crypto';
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
  d: DeliveryFixtures;
  m8: ScopeFixtures;
  m9: FinanceFixtures;
  m10: AutomationFixtures;
}

/** M10: the signed-in user's own notification, a dead job and an import run to undo. */
interface AutomationFixtures {
  /** Null for portal users, who have no notifications. */
  myNotification: string | null;
  deadJob: string;
  importRun: string;
}

const IMPORT_CSV = 'Name,Email\nMatrix Import,matrix.import@x.test\n';
const IMPORT_SHA = createHash('sha256').update(IMPORT_CSV, 'utf8').digest('hex');

/** M9: invoices in each state on a project the PM manages, plus a published portal invoice. */
interface FinanceFixtures {
  orgId: string;
  project: string;
  invRead: string;
  invDraft: string;
  invIssue: { id: string; version: number };
  invPublish: string;
  invVoid: string;
  invDelete: string;
  invPay: string;
  invReverse: { id: string; paymentId: string };
  portalInvoice: string;
  rateUser: string;
}

/** M8: change requests in each state, and comments written by the role under test. */
interface ScopeFixtures {
  readProject: string;
  changeRead: string;
  changeDraft: string;
  changeSubmit: string;
  changeReview: string;
  changeSend: string;
  changeWithdraw: string;
  portalChange: string;
  portalDecide: { id: string; hash: string };
  commentEdit: string;
  commentDelete: string;
  commentHistory: string;
  portalCommentEdit: string;
  portalCommentDelete: string;
  portalCommentHistory: string;
}

/** M7: tasks, time, files, deliverables, shares and the portal for projects. */
interface DeliveryFixtures {
  project: string;
  taskRead: string;
  taskPatch: string;
  taskStatus: string;
  taskDep: string;
  taskDepTarget: string;
  taskDepRemove: string;
  taskTime: string;
  entryPatch: string;
  entryDelete: string;
  fileLink: string;
  fileDelete: string;
  fileForVersion: string;
  delivRead: string;
  delivPatch: string;
  delivVersion: string;
  delivPublish: { id: string; version: number };
  delivArchive: string;
  milestone: string;
  shareProject: string;
  revokeProject: string;
  shareUser: string;
  portalProject: string;
  portalDeliverable: string;
  portalDecide: { id: string; versionId: string };
  portalFile: string;
}

interface Endpoint {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put';
  path: (f: Fixtures) => string;
  body?: (role: Role, f: Fixtures) => object;
  headers?: () => Record<string, string>;
  /** Raw request body (file uploads). */
  raw?: Buffer;
  allowed: Role[];
}

const STAFF: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE'];
const SALES_SIDE: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'];
const SALES_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER'];
const TEAM_ADMINS: Role[] = ['OWNER', 'ADMIN'];
const CLIENT_ONLY: Role[] = ['CLIENT'];
const PROJECT_READERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER'];
const PROJECT_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'PM'];
/** Delivery work: tasks, own time, files and deliverables (spec §1.1 P / Assigned / Own). */
const DELIVERY: Role[] = ['OWNER', 'ADMIN', 'PM', 'MEMBER'];
/** Spec §1.1 "Manage invoice state": A for Owner/Admin/Finance, Read P for PM. */
const INVOICE_READERS: Role[] = ['OWNER', 'ADMIN', 'FINANCE', 'PM'];
const INVOICE_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'FINANCE'];
/** FR-F04: only Finance and the Owner change payment status. */
const PAYERS: Role[] = ['OWNER', 'FINANCE'];
/** M10: CSV imports need agency-wide CRM reads. */
const IMPORTERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER'];
const PDF = Buffer.from('%PDF-1.4\n%matrix\n%%EOF\n');
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
    name: 'GET /projects/staff',
    method: 'get',
    path: () => '/api/v1/projects/staff',
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /projects/client-orgs',
    method: 'get',
    path: () => '/api/v1/projects/client-orgs',
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
  // Delivery (M7). GET /files/download/:token is not role-gated (the token names the user);
  // it is covered by the signed-out check below and by delivery-portal.test.ts.
  {
    name: 'GET /projects/:id/tasks',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.d.project}/tasks`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /projects/:id/tasks',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.project}/tasks`,
    body: (r) => ({ title: `Task by ${r}` }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /tasks/:id',
    method: 'get',
    path: (f) => `/api/v1/tasks/${f.d.taskRead}`,
    allowed: DELIVERY,
  },
  {
    name: 'PATCH /tasks/:id',
    method: 'patch',
    path: (f) => `/api/v1/tasks/${f.d.taskPatch}`,
    body: () => ({ version: 1, title: 'Changed task' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /tasks/:id/status (assignee)',
    method: 'post',
    path: (f) => `/api/v1/tasks/${f.d.taskStatus}/status`,
    body: () => ({ version: 1, status: 'IN_PROGRESS' }),
    allowed: DELIVERY,
  },
  {
    name: 'POST /tasks/:id/dependencies',
    method: 'post',
    path: (f) => `/api/v1/tasks/${f.d.taskDep}/dependencies`,
    body: (_r, f) => ({ dependsOnId: f.d.taskDepTarget }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /tasks/:id/dependencies/:id/remove',
    method: 'post',
    path: (f) => `/api/v1/tasks/${f.d.taskDepRemove}/dependencies/${f.d.taskDepTarget}/remove`,
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /tasks/:id/time',
    method: 'get',
    path: (f) => `/api/v1/tasks/${f.d.taskTime}/time`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /tasks/:id/time',
    method: 'post',
    path: (f) => `/api/v1/tasks/${f.d.taskTime}/time`,
    body: () => ({ workedOn: '2026-10-01', minutes: 15 }),
    allowed: DELIVERY,
  },
  {
    name: 'PATCH /time-entries/:id (own)',
    method: 'patch',
    path: (f) => `/api/v1/time-entries/${f.d.entryPatch}`,
    body: () => ({ version: 1, minutes: 20 }),
    allowed: DELIVERY,
  },
  {
    name: 'POST /time-entries/:id/delete (own)',
    method: 'post',
    path: (f) => `/api/v1/time-entries/${f.d.entryDelete}/delete`,
    allowed: DELIVERY,
  },
  {
    name: 'GET /projects/:id/time',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.d.project}/time`,
    allowed: DELIVERY,
  },
  {
    name: 'GET /projects/:id/files',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.d.project}/files`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /projects/:id/files',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.project}/files`,
    headers: () => ({ 'X-File-Name': 'matrix.pdf', 'Content-Type': 'application/octet-stream' }),
    raw: PDF,
    allowed: DELIVERY,
  },
  {
    name: 'POST /files/:id/download-url',
    method: 'post',
    path: (f) => `/api/v1/files/${f.d.fileLink}/download-url`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /files/:id/delete',
    method: 'post',
    path: (f) => `/api/v1/files/${f.d.fileDelete}/delete`,
    allowed: DELIVERY,
  },
  {
    name: 'GET /projects/:id/deliverables',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.d.project}/deliverables`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /projects/:id/deliverables',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.project}/deliverables`,
    body: (r) => ({ title: `Deliverable by ${r}` }),
    allowed: DELIVERY,
  },
  {
    name: 'GET /deliverables/:id',
    method: 'get',
    path: (f) => `/api/v1/deliverables/${f.d.delivRead}`,
    allowed: DELIVERY,
  },
  {
    name: 'PATCH /deliverables/:id',
    method: 'patch',
    path: (f) => `/api/v1/deliverables/${f.d.delivPatch}`,
    body: () => ({ version: 1, title: 'Changed deliverable' }),
    allowed: DELIVERY,
  },
  {
    name: 'POST /deliverables/:id/versions',
    method: 'post',
    path: (f) => `/api/v1/deliverables/${f.d.delivVersion}/versions`,
    body: (_r, f) => ({ fileId: f.d.fileForVersion }),
    allowed: DELIVERY,
  },
  {
    name: 'POST /deliverables/:id/publish',
    method: 'post',
    path: (f) => `/api/v1/deliverables/${f.d.delivPublish.id}/publish`,
    body: (_r, f) => ({ version: f.d.delivPublish.version }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /deliverables/:id/archive',
    method: 'post',
    path: (f) => `/api/v1/deliverables/${f.d.delivArchive}/archive`,
    body: () => ({ version: 1 }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/milestones/:id/move',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.project}/milestones/${f.d.milestone}/move`,
    body: () => ({ direction: 'down' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /projects/:id/shares',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.d.shareProject}/shares`,
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/shares',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.shareProject}/shares`,
    body: (_r, f) => ({ userId: f.d.shareUser }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /projects/:id/shares/:userId/revoke',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.revokeProject}/shares/${f.d.shareUser}/revoke`,
    allowed: PROJECT_MANAGERS,
  },
  // Scope changes and comments (M8)
  {
    name: 'GET /projects/:id/changes',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.m8.readProject}/changes`,
    allowed: PROJECT_READERS,
  },
  {
    name: 'POST /projects/:id/changes',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.d.project}/changes`,
    body: (r) => ({ title: `Change by ${r}`, description: 'Matrix change request' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /changes/:id',
    method: 'get',
    path: (f) => `/api/v1/changes/${f.m8.changeRead}`,
    allowed: PROJECT_READERS,
  },
  {
    name: 'PUT /changes/:id/draft',
    method: 'put',
    path: (f) => `/api/v1/changes/${f.m8.changeDraft}/draft`,
    body: () => ({ version: 1, scope: 'Matrix scope', price: '100.00' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /changes/:id/submit',
    method: 'post',
    path: (f) => `/api/v1/changes/${f.m8.changeSubmit}/submit`,
    body: () => ({ version: 1 }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /changes/:id/review',
    method: 'post',
    path: (f) => `/api/v1/changes/${f.m8.changeReview}/review`,
    body: () => ({ version: 1, decision: 'APPROVE' }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /changes/:id/send',
    method: 'post',
    path: (f) => `/api/v1/changes/${f.m8.changeSend}/send`,
    body: () => ({ version: 1 }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'POST /changes/:id/withdraw',
    method: 'post',
    path: (f) => `/api/v1/changes/${f.m8.changeWithdraw}/withdraw`,
    body: () => ({ version: 1, reason: 'Matrix withdraw' }),
    allowed: PROJECT_MANAGERS,
  },
  {
    name: 'GET /projects/:id/comments',
    method: 'get',
    path: (f) =>
      `/api/v1/projects/${f.m8.readProject}/comments?entityType=change&entityId=${f.m8.changeRead}`,
    allowed: DELIVERY,
  },
  {
    name: 'POST /projects/:id/comments',
    method: 'post',
    path: (f) => `/api/v1/projects/${f.m8.readProject}/comments`,
    body: (r, f) => ({ entityType: 'change', entityId: f.m8.changeRead, body: `Comment by ${r}` }),
    allowed: DELIVERY,
  },
  {
    name: 'PATCH /comments/:id (own)',
    method: 'patch',
    path: (f) => `/api/v1/comments/${f.m8.commentEdit}`,
    body: () => ({ version: 1, body: 'Edited in the matrix' }),
    allowed: DELIVERY,
  },
  {
    name: 'POST /comments/:id/delete (own)',
    method: 'post',
    path: (f) => `/api/v1/comments/${f.m8.commentDelete}/delete`,
    body: () => ({ version: 1 }),
    allowed: DELIVERY,
  },
  {
    name: 'GET /comments/:id/history',
    method: 'get',
    path: (f) => `/api/v1/comments/${f.m8.commentHistory}/history`,
    allowed: DELIVERY,
  },
  // Invoices and finance (M9)
  {
    name: 'GET /invoices',
    method: 'get',
    path: () => '/api/v1/invoices',
    allowed: INVOICE_READERS,
  },
  {
    name: 'POST /invoices',
    method: 'post',
    path: () => '/api/v1/invoices',
    headers: () => ({ 'Idempotency-Key': randomUUID() }),
    body: (_r, f) => ({ clientOrgId: f.m9.orgId, dueOn: '2027-01-31' }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'GET /invoices/options',
    method: 'get',
    path: () => '/api/v1/invoices/options',
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'GET /invoices/:id',
    method: 'get',
    path: (f) => `/api/v1/invoices/${f.m9.invRead}`,
    allowed: INVOICE_READERS,
  },
  {
    name: 'PUT /invoices/:id/draft',
    method: 'put',
    path: (f) => `/api/v1/invoices/${f.m9.invDraft}/draft`,
    body: () => ({
      version: 1,
      dueOn: '2027-01-31',
      taxRatePercent: '14',
      items: [{ description: 'Line', quantity: '1', unitPrice: '10.00' }],
    }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /invoices/:id/issue',
    method: 'post',
    path: (f) => `/api/v1/invoices/${f.m9.invIssue.id}/issue`,
    body: (_r, f) => ({ version: f.m9.invIssue.version }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /invoices/:id/publish',
    method: 'post',
    path: (f) => `/api/v1/invoices/${f.m9.invPublish}/publish`,
    body: () => ({ version: 1 }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /invoices/:id/void',
    method: 'post',
    path: (f) => `/api/v1/invoices/${f.m9.invVoid}/void`,
    body: () => ({ version: 1, reason: 'Matrix void' }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /invoices/:id/delete',
    method: 'post',
    path: (f) => `/api/v1/invoices/${f.m9.invDelete}/delete`,
    body: () => ({ version: 1 }),
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /invoices/:id/payments',
    method: 'post',
    path: (f) => `/api/v1/invoices/${f.m9.invPay}/payments`,
    headers: () => ({ 'Idempotency-Key': randomUUID() }),
    body: () => ({ amount: '1.00', receivedOn: '2026-10-01', reference: 'MATRIX-1' }),
    allowed: PAYERS,
  },
  {
    name: 'POST /invoices/:id/payments/:id/reverse',
    method: 'post',
    path: (f) =>
      `/api/v1/invoices/${f.m9.invReverse.id}/payments/${f.m9.invReverse.paymentId}/reverse`,
    body: () => ({ reason: 'Matrix reversal' }),
    allowed: PAYERS,
  },
  {
    name: 'GET /projects/:id/finance',
    method: 'get',
    path: (f) => `/api/v1/projects/${f.m9.project}/finance`,
    allowed: INVOICE_READERS,
  },
  {
    name: 'GET /reports/finance',
    method: 'get',
    path: () => '/api/v1/reports/finance',
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'GET /exports/invoices.csv',
    method: 'get',
    path: () => '/api/v1/exports/invoices.csv',
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'GET /cost-rates',
    method: 'get',
    path: () => '/api/v1/cost-rates',
    allowed: INVOICE_MANAGERS,
  },
  {
    name: 'POST /users/:id/cost-rates',
    method: 'post',
    path: (f) => `/api/v1/users/${f.m9.rateUser}/cost-rates`,
    body: () => ({ hourly: '250.00', currency: 'EGP', effectiveFrom: '2026-10-01' }),
    allowed: TEAM_ADMINS,
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
  // Client portal for projects (M7)
  {
    name: 'GET /portal/projects',
    method: 'get',
    path: () => '/api/v1/portal/projects',
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/projects/:id',
    method: 'get',
    path: (f) => `/api/v1/portal/projects/${f.d.portalProject}`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/deliverables/:id',
    method: 'get',
    path: (f) => `/api/v1/portal/deliverables/${f.d.portalDeliverable}`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/deliverables/:id/decision',
    method: 'post',
    path: (f) => `/api/v1/portal/deliverables/${f.d.portalDecide.id}/decision`,
    body: (_r, f) => ({ versionId: f.d.portalDecide.versionId, decision: 'APPROVE' }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/files/:id/download-url',
    method: 'post',
    path: (f) => `/api/v1/portal/files/${f.d.portalFile}/download-url`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/projects/:id/changes',
    method: 'get',
    path: (f) => `/api/v1/portal/projects/${f.d.portalProject}/changes`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/projects/:id/changes',
    method: 'post',
    path: (f) => `/api/v1/portal/projects/${f.d.portalProject}/changes`,
    body: () => ({ title: 'Client matrix request', description: 'Please add a page' }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/changes/:id',
    method: 'get',
    path: (f) => `/api/v1/portal/changes/${f.m8.portalChange}`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/changes/:id/decision',
    method: 'post',
    path: (f) => `/api/v1/portal/changes/${f.m8.portalDecide.id}/decision`,
    body: (_r, f) => ({ decision: 'ACCEPT', contentHash: f.m8.portalDecide.hash }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/comments',
    method: 'get',
    path: (f) => `/api/v1/portal/comments?entityType=change&entityId=${f.m8.portalChange}`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/comments',
    method: 'post',
    path: () => '/api/v1/portal/comments',
    body: (_r, f) => ({
      entityType: 'change',
      entityId: f.m8.portalChange,
      body: 'Client comment',
    }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'PATCH /portal/comments/:id',
    method: 'patch',
    path: (f) => `/api/v1/portal/comments/${f.m8.portalCommentEdit}`,
    body: () => ({ version: 1, body: 'Client edit' }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'POST /portal/comments/:id/delete',
    method: 'post',
    path: (f) => `/api/v1/portal/comments/${f.m8.portalCommentDelete}/delete`,
    body: () => ({ version: 1 }),
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/comments/:id/history',
    method: 'get',
    path: (f) => `/api/v1/portal/comments/${f.m8.portalCommentHistory}/history`,
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/invoices',
    method: 'get',
    path: () => '/api/v1/portal/invoices',
    allowed: CLIENT_ONLY,
  },
  {
    name: 'GET /portal/invoices/:id',
    method: 'get',
    path: (f) => `/api/v1/portal/invoices/${f.m9.portalInvoice}`,
    allowed: CLIENT_ONLY,
  },
  // Notifications, jobs and imports (M10)
  {
    name: 'GET /notifications',
    method: 'get',
    path: () => '/api/v1/notifications',
    allowed: STAFF,
  },
  {
    name: 'GET /notifications/unread-count',
    method: 'get',
    path: () => '/api/v1/notifications/unread-count',
    allowed: STAFF,
  },
  {
    name: 'PATCH /notifications/:id/read',
    method: 'patch',
    // Portal users have none: they ask for a random ID and must get 403, not 404.
    path: (f) => `/api/v1/notifications/${f.m10.myNotification ?? randomUUID()}/read`,
    allowed: STAFF,
  },
  {
    name: 'POST /notifications/read-all',
    method: 'post',
    path: () => '/api/v1/notifications/read-all',
    body: () => ({ upTo: new Date().toISOString() }),
    allowed: STAFF,
  },
  {
    name: 'GET /notification-preferences',
    method: 'get',
    path: () => '/api/v1/notification-preferences',
    allowed: STAFF,
  },
  {
    name: 'PUT /notification-preferences',
    method: 'put',
    path: () => '/api/v1/notification-preferences',
    body: () => ({ preferences: [{ category: 'TASKS', inApp: true, email: true }] }),
    allowed: STAFF,
  },
  { name: 'GET /jobs', method: 'get', path: () => '/api/v1/jobs', allowed: TEAM_ADMINS },
  {
    name: 'POST /jobs/:id/retry',
    method: 'post',
    path: (f) => `/api/v1/jobs/${f.m10.deadJob}/retry`,
    allowed: TEAM_ADMINS,
  },
  { name: 'GET /imports', method: 'get', path: () => '/api/v1/imports', allowed: IMPORTERS },
  {
    name: 'POST /imports/preview',
    method: 'post',
    path: () => '/api/v1/imports/preview',
    body: () => ({ kind: 'contacts', csv: IMPORT_CSV }),
    allowed: IMPORTERS,
  },
  {
    name: 'POST /imports',
    method: 'post',
    path: () => '/api/v1/imports',
    headers: () => ({ 'Idempotency-Key': randomUUID() }),
    body: () => ({
      kind: 'contacts',
      csv: IMPORT_CSV,
      mapping: { fullName: 'Name', email: 'Email' },
      fileSha256: IMPORT_SHA,
    }),
    allowed: IMPORTERS,
  },
  {
    name: 'POST /imports/:id/undo',
    method: 'post',
    path: (f) => `/api/v1/imports/${f.m10.importRun}/undo`,
    allowed: IMPORTERS,
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
async function freshFixtures(seeded: SeededAgency, role?: Role): Promise<Fixtures> {
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
  const d = await deliveryFixtures(seeded, role, portal.orgId, portal.clientUserId);
  const m8 = await scopeFixtures(seeded, role, projRead.projectId, d, portal.clientUserId);
  const m9 = await financeFixtures(seeded, d, portal.orgId);
  const m10 = await automationFixtures(seeded, role);

  return {
    d,
    m8,
    m9,
    m10,
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

/**
 * M7 fixtures on projects managed by pm with member on the team. Time entries for the "own"
 * endpoints are written by the user of the role under test, so each delivery role edits its own.
 */
async function deliveryFixtures(
  seeded: SeededAgency,
  role: Role | undefined,
  orgId: string,
  clientUserId: string,
): Promise<DeliveryFixtures> {
  const { agencyId } = seeded;
  const pmId = seeded.users.pm!.id;
  const memberId = seeded.users.member!.id;
  const author = role && DELIVERY.includes(role) ? seeded.users[KEY_FOR_ROLE[role]!]!.id : memberId;
  const proj = async () =>
    (
      await makeProject(db, {
        agencyId,
        managerId: pmId,
        createdById: pmId,
        memberIds: [memberId],
        clientOrgId: orgId,
      })
    ).projectId;
  const project = await proj();
  const ms = await db.projectMilestone.findFirstOrThrow({ where: { projectId: project } });
  await db.projectMilestone.create({
    data: { agencyId, projectId: project, title: 'Second', sequence: 1 },
  });
  const task = (title: string, projectId = project) =>
    db.task.create({
      data: { agencyId, projectId, title, assigneeId: memberId, createdById: pmId },
    });
  const [taskRead, taskPatch, taskStatus, taskDep, taskDepTarget, taskDepRemove, taskTime] =
    await Promise.all(
      ['read', 'patch', 'status', 'dep', 'target', 'remove', 'time'].map((t) => task(t)),
    );
  await db.taskDependency.create({
    data: { projectId: project, taskId: taskDepRemove!.id, dependsOnId: taskDepTarget!.id },
  });
  const entry = () =>
    db.timeEntry.create({
      data: {
        agencyId,
        projectId: project,
        taskId: taskTime!.id,
        userId: author,
        workedOn: new Date('2026-10-01'),
        minutes: 30,
      },
    });
  const [entryPatch, entryDelete] = [await entry(), await entry()];
  const file = (projectId = project) =>
    db.storedFile.create({
      data: {
        agencyId,
        projectId,
        uploadedById: memberId,
        storageKey: randomUUID(),
        originalName: 'fixture.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });
  const [fileLink, fileDelete, fileForVersion] = [await file(), await file(), await file()];
  const deliverable = (title: string, projectId = project, extra: object = {}) =>
    db.deliverable.create({
      data: { agencyId, projectId, title, createdById: memberId, ...extra },
    });
  const withVersion = async (title: string, projectId: string, publishedAt: Date | null) => {
    const f = await file(projectId);
    const dl = await deliverable(title, projectId, {
      status: publishedAt ? 'PUBLISHED' : 'READY',
      currentVersionNo: 1,
      publishedAt,
    });
    const v = await db.deliverableVersion.create({
      data: {
        agencyId,
        projectId,
        deliverableId: dl.id,
        versionNo: 1,
        fileId: f.id,
        fileSha256: f.sha256,
        createdById: memberId,
        publishedAt,
        publishedById: publishedAt ? pmId : null,
      },
    });
    return { deliverable: dl, version: v, file: f };
  };
  const [delivRead, delivPatch, delivVersion, delivArchive] = await Promise.all(
    ['read', 'patch', 'version', 'archive'].map((t) => deliverable(`Deliverable ${t}`)),
  );
  const publish = await withVersion('To publish', project, null);

  // Sharing: one project not shared yet, one shared (to revoke), one shared for the portal.
  const [shareProject, revokeProject, portalProject] = [await proj(), await proj(), await proj()];
  for (const projectId of [revokeProject, portalProject]) {
    await db.projectShare.create({
      data: { agencyId, projectId, userId: clientUserId, sharedById: pmId },
    });
  }
  const now = new Date();
  const portalRead = await withVersion('Portal read', portalProject, now);
  const portalDecide = await withVersion('Portal decide', portalProject, now);
  return {
    project,
    taskRead: taskRead!.id,
    taskPatch: taskPatch!.id,
    taskStatus: taskStatus!.id,
    taskDep: taskDep!.id,
    taskDepTarget: taskDepTarget!.id,
    taskDepRemove: taskDepRemove!.id,
    taskTime: taskTime!.id,
    entryPatch: entryPatch.id,
    entryDelete: entryDelete.id,
    fileLink: fileLink.id,
    fileDelete: fileDelete.id,
    fileForVersion: fileForVersion.id,
    delivRead: delivRead!.id,
    delivPatch: delivPatch!.id,
    delivVersion: delivVersion!.id,
    delivPublish: { id: publish.deliverable.id, version: publish.deliverable.version },
    delivArchive: delivArchive!.id,
    milestone: ms.id,
    shareProject,
    revokeProject,
    shareUser: clientUserId,
    portalProject,
    portalDeliverable: portalRead.deliverable.id,
    portalDecide: { id: portalDecide.deliverable.id, versionId: portalDecide.version.id },
    portalFile: portalRead.file.id,
  };
}

/** M8 fixtures. Staff comments for the "own" endpoints are written by the role under test. */
async function scopeFixtures(
  seeded: SeededAgency,
  role: Role | undefined,
  readProject: string,
  d: DeliveryFixtures,
  clientUserId: string,
): Promise<ScopeFixtures> {
  const { agencyId } = seeded;
  const pmId = seeded.users.pm!.id;
  const memberId = seeded.users.member!.id;
  const author = role && DELIVERY.includes(role) ? seeded.users[KEY_FOR_ROLE[role]!]!.id : memberId;
  let n = 0;
  const change = async (
    projectId: string,
    status: 'REQUESTED' | 'ESTIMATING' | 'IN_REVIEW' | 'AWAITING_CLIENT',
    versionStatus?: 'DRAFT' | 'IN_REVIEW' | 'APPROVED_INTERNAL' | 'SENT',
  ) => {
    n += 1;
    const c = await db.changeRequest.create({
      data: {
        agencyId,
        projectId,
        number: n,
        title: `Change ${n}`,
        description: 'Matrix fixture',
        status,
        currentVersionNo: versionStatus ? 1 : 0,
        requestedById: pmId,
      },
    });
    const hash = n.toString(16).padStart(64, '0');
    if (versionStatus) {
      const sent = versionStatus === 'SENT';
      await db.changeVersion.create({
        data: {
          agencyId,
          projectId,
          changeRequestId: c.id,
          versionNo: 1,
          status: versionStatus,
          scope: 'Fixture scope',
          priceMinor: 10_000n,
          currency: 'EGP',
          taxMinor: 1_400n,
          totalMinor: 11_400n,
          createdById: pmId,
          ...(versionStatus === 'APPROVED_INTERNAL'
            ? { approvedAt: new Date(), approvedById: seeded.users.owner!.id }
            : {}),
          ...(sent ? { sentAt: new Date(), sentById: pmId, contentHash: hash } : {}),
        },
      });
    }
    return { id: c.id, hash };
  };
  const changeRead = await change(readProject, 'ESTIMATING', 'DRAFT');
  const changeDraft = await change(d.project, 'REQUESTED');
  const changeSubmit = await change(d.project, 'ESTIMATING', 'DRAFT');
  const changeReview = await change(d.project, 'IN_REVIEW', 'IN_REVIEW');
  const changeSend = await change(d.project, 'IN_REVIEW', 'APPROVED_INTERNAL');
  const changeWithdraw = await change(d.project, 'REQUESTED');
  const portalChange = await change(d.portalProject, 'AWAITING_CLIENT', 'SENT');
  const portalDecide = await change(d.portalProject, 'AWAITING_CLIENT', 'SENT');
  const comment = (projectId: string, entityId: string, authorId: string) =>
    db.projectComment.create({
      data: {
        agencyId,
        projectId,
        entityType: 'change',
        entityId,
        authorId,
        body: 'Fixture comment',
      },
    });
  const staffThread = (who: string) => comment(readProject, changeRead.id, who);
  const portalThread = () => comment(d.portalProject, portalChange.id, clientUserId);
  return {
    readProject,
    changeRead: changeRead.id,
    changeDraft: changeDraft.id,
    changeSubmit: changeSubmit.id,
    changeReview: changeReview.id,
    changeSend: changeSend.id,
    changeWithdraw: changeWithdraw.id,
    portalChange: portalChange.id,
    portalDecide,
    commentEdit: (await staffThread(author)).id,
    commentDelete: (await staffThread(author)).id,
    commentHistory: (await staffThread(memberId)).id,
    portalCommentEdit: (await portalThread()).id,
    portalCommentDelete: (await portalThread()).id,
    portalCommentHistory: (await portalThread()).id,
  };
}

/** M10 fixtures. The notification belongs to the role's own seeded user. */
async function automationFixtures(seeded: SeededAgency, role?: Role): Promise<AutomationFixtures> {
  const { agencyId } = seeded;
  const me = role && role !== 'CLIENT' ? seeded.users[KEY_FOR_ROLE[role]!]!.id : null;
  const myNotification = me
    ? (
        await db.notification.create({
          data: {
            agencyId,
            recipientId: me,
            category: 'TASKS',
            type: 'matrix',
            title: 'Matrix notification',
            link: '/app/dashboard',
          },
        })
      ).id
    : null;
  const deadJob = await db.outboxJob.create({
    data: {
      agencyId,
      kind: 'reminders.scan',
      payload: { agencyId },
      state: 'DEAD',
      attempts: 6,
      finishedAt: new Date(),
      lastError: 'Error: matrix',
    },
  });
  const importRun = await db.importRun.create({
    data: {
      agencyId,
      actorId: seeded.users.manager!.id,
      kind: 'contacts',
      fileSha256: 'c'.repeat(64),
      rowsTotal: 0,
      rowsCreated: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
    },
  });
  return { myNotification, deadJob: deadJob.id, importRun: importRun.id };
}

/** M9 fixtures: invoices on the portal organization's delivery project (managed by pm). */
async function financeFixtures(
  seeded: SeededAgency,
  d: DeliveryFixtures,
  orgId: string,
): Promise<FinanceFixtures> {
  const { agencyId } = seeded;
  const financeId = seeded.users.finance!.id;
  let n = 0;
  const invoice = async (status: 'DRAFT' | 'ISSUED', extra: object = {}) => {
    const issuedFields =
      status === 'ISSUED'
        ? {
            status: 'ISSUED' as const,
            number: ++n,
            issuedOn: new Date('2026-10-01'),
            issuedAt: new Date(),
            issuedById: financeId,
            billedToName: 'Fixture client',
            issuerName: 'Test Agency',
          }
        : {};
    const i = await db.invoice.create({
      data: {
        agencyId,
        clientOrgId: orgId,
        projectId: d.project,
        currency: 'EGP',
        dueOn: new Date('2099-01-31'),
        createdById: financeId,
        subtotalMinor: 10_000n,
        taxMinor: 1_400n,
        totalMinor: 11_400n,
        ...issuedFields,
        ...extra,
      },
    });
    // Lines can only be added while the invoice is a draft, so issued ones get theirs first.
    return i;
  };
  const withLine = async () => {
    const i = await invoice('DRAFT');
    await db.invoiceItem.create({
      data: {
        invoiceId: i.id,
        position: 0,
        description: 'Line',
        quantityCenti: 100,
        unitPriceMinor: 10_000n,
        lineTotalMinor: 10_000n,
      },
    });
    return i;
  };
  const invRead = await invoice('ISSUED');
  const invDraft = await invoice('DRAFT');
  const invIssue = await withLine();
  const invPublish = await invoice('ISSUED');
  const invVoid = await invoice('ISSUED');
  const invDelete = await invoice('DRAFT');
  const invPay = await invoice('ISSUED');
  const invReverse = await invoice('ISSUED', { status: 'PARTIALLY_PAID', paidMinor: 100n });
  const payment = await db.payment.create({
    data: {
      agencyId,
      invoiceId: invReverse.id,
      amountMinor: 100n,
      currency: 'EGP',
      receivedOn: new Date('2026-10-01'),
      recordedById: financeId,
    },
  });
  const portalInvoice = await invoice('ISSUED', { publishedAt: new Date() });
  // The counter matches the numbers used above, as issuing would have left it.
  await db.agency.update({ where: { id: agencyId }, data: { invoiceSeq: n } });
  return {
    orgId,
    project: d.project,
    invRead: invRead.id,
    invDraft: invDraft.id,
    invIssue: { id: invIssue.id, version: invIssue.version },
    invPublish: invPublish.id,
    invVoid: invVoid.id,
    invDelete: invDelete.id,
    invPay: invPay.id,
    invReverse: { id: invReverse.id, paymentId: payment.id },
    portalInvoice: portalInvoice.id,
    rateUser: seeded.users.member!.id,
  };
}

describe('role × endpoint matrix', () => {
  it.each(EVERYONE)('%s gets exactly the access spec §1.1 grants', async (role) => {
    await resetDb();
    const seeded = await seedAgency();
    const f = await freshFixtures(seeded, role);
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
      if (ep.raw) req = req.send(ep.raw);
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
      expect(await db.project.count()).toBe(12);
      // A client accepting a change updates that project's baseline: the one allowed change.
      expect(
        await db.project.count({
          where: {
            version: { gt: 1 },
            ...(role === 'CLIENT' ? { id: { not: f.d.portalProject } } : {}),
          },
        }),
      ).toBe(0);
      expect(await db.projectMilestone.count({ where: { status: { not: 'PLANNED' } } })).toBe(0);
      expect(await db.handoffChecklistItem.count({ where: { doneAt: { not: null } } })).toBe(0);
      expect(await db.projectMember.count()).toBe(6);
    }
    if (!DELIVERY.includes(role)) {
      expect(await db.task.count({ where: { version: { gt: 1 } } })).toBe(0);
      expect(await db.task.count()).toBe(7);
      expect(await db.taskDependency.count()).toBe(1);
      expect(await db.timeEntry.count()).toBe(2);
      expect(await db.storedFile.count()).toBe(6);
      // The client's own decision is the one allowed change (checked below).
      expect(await db.deliverable.count({ where: { version: { gt: 1 } } })).toBe(
        role === 'CLIENT' ? 1 : 0,
      );
      expect(await db.deliverable.count()).toBe(7);
      expect(await db.deliverableVersion.count({ where: { publishedAt: { not: null } } })).toBe(2);
      expect(await db.projectShare.count({ where: { revokedAt: null } })).toBe(2);
    }
    if (role === 'MEMBER') {
      // Members work on tasks but never edit them, change dependencies, publish or share.
      expect((await db.task.findUniqueOrThrow({ where: { id: f.d.taskPatch } })).title).toBe(
        'patch',
      );
      expect(await db.taskDependency.count()).toBe(1);
      expect(
        (await db.deliverable.findUniqueOrThrow({ where: { id: f.d.delivPublish.id } })).status,
      ).toBe('READY');
      expect(await db.projectShare.count({ where: { revokedAt: null } })).toBe(2);
    }
    if (!PROJECT_MANAGERS.includes(role)) {
      // Nobody without manage rights created, estimated, sent or withdrew a change. Only the
      // client's own request and decision are allowed below.
      expect(await db.changeRequest.count()).toBe(role === 'CLIENT' ? 9 : 8);
      expect(
        await db.changeRequest.count({
          where: { version: { gt: 1 }, id: { not: f.m8.portalDecide.id } },
        }),
      ).toBe(0);
      expect(await db.changeVersion.count()).toBe(6);
    }
    if (role === 'CLIENT') {
      expect(await db.changeDecision.count()).toBe(1);
    } else {
      expect(await db.changeDecision.count()).toBe(0);
    }
    if (!DELIVERY.includes(role) && role !== 'CLIENT') {
      expect(await db.projectComment.count()).toBe(6);
      expect(await db.projectCommentRevision.count()).toBe(0);
    }
    if (!INVOICE_MANAGERS.includes(role)) {
      // No invoice was created, edited, issued, published, voided or deleted.
      expect(await db.invoice.count()).toBe(9);
      expect(await db.invoice.count({ where: { version: { gt: 1 } } })).toBe(0);
      expect(await db.invoiceItem.count()).toBe(1);
      expect(await db.costRate.count()).toBe(0);
    }
    if (!PAYERS.includes(role)) {
      // T-PAY-02: no payment or reversal was recorded.
      expect(await db.payment.count()).toBe(1);
    }
    if (role === 'CLIENT') {
      expect(await db.deliverableReview.count()).toBe(1);
    } else {
      expect(await db.deliverableReview.count()).toBe(0);
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
      if (ep.raw) req = req.send(ep.raw);
      const res = await req;
      expect({ ep: ep.name, status: res.status }).toEqual({ ep: ep.name, status: 401 });
    }
  });
});
