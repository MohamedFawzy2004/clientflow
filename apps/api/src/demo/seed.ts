// Builds the fictional demo workspace (spec §21, FR-A08) through the real API, so every record
// passes the same validation, permissions, workflow rules and audit trail as real use. Only the
// owner bootstrap and the demo flag are written directly.
//
// All people, companies and references are fictional. Email addresses use the reserved .test
// domain, which can never receive mail.
import PDFDocument from 'pdfkit';
import type {
  ChangeDetail,
  ClientOrgDetail,
  ContactDetail,
  ConvertResult,
  DealDetail,
  DeliverableDetail,
  FileView,
  InvitationCreated,
  InvoiceDetail,
  PipelineSummary,
  PortalInvitationCreated,
  PortalProposalDetail,
  ProjectDetail,
  ProposalDetail,
  TaskView,
} from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import { bootstrapOwner } from '../modules/auth/bootstrap.js';
import { generateToken } from '../lib/tokens.js';
import { DemoClient } from './client.js';

export const DEMO_DOMAIN = 'demo.clientflow.test';

export interface DemoCredential {
  email: string;
  role: string;
  name: string;
  password: string;
}

const DAY = 86_400_000;
/** A calendar date `n` days from today (UTC), as the API expects. */
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const at = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

const STAFF = [
  { key: 'admin', name: 'Hana Adly', role: 'ADMIN' },
  { key: 'sales.manager', name: 'Karim Fathy', role: 'SALES_MANAGER' },
  { key: 'sales.a', name: 'Nour Salem', role: 'SALES' },
  { key: 'sales.b', name: 'Omar Zaki', role: 'SALES' },
  { key: 'pm', name: 'Yara Mansour', role: 'PM' },
  { key: 'member.a', name: 'Ali Hassan', role: 'MEMBER' },
  { key: 'member.b', name: 'Farida Nasser', role: 'MEMBER' },
  { key: 'finance', name: 'Tarek Habib', role: 'FINANCE' },
] as const;
type Who = 'owner' | (typeof STAFF)[number]['key'];

/** 20 fictional leads. The first three become clients with their own portal organization. */
const LEADS: Array<{
  name: string;
  company?: string;
  source: string;
  owner: Who;
  phone?: string;
  next?: number;
  notes?: string;
}> = [
  {
    name: 'Salma Ibrahim',
    company: 'Nile Bakery Co.',
    source: 'REFERRAL',
    owner: 'sales.a',
    phone: '+20 100 555 0101',
    notes: 'Wants online ordering live before the holiday season.',
  },
  {
    name: 'Ahmed Rostom',
    company: 'Delta Logistics',
    source: 'WEBSITE',
    owner: 'sales.b',
    notes: 'Fleet tracking dashboard for 40 vans.',
  },
  {
    name: 'Laila Haddad',
    company: 'Haddad Dental Clinics',
    source: 'EVENT',
    owner: 'sales.a',
    phone: '+20 122 555 0144',
  },
  {
    name: 'Rana El-Sayed',
    company: 'Sayed Fashion House',
    source: 'SOCIAL',
    owner: 'sales.b',
    next: 1,
    notes: 'Instagram shop moving to a full online store.',
  },
  {
    name: 'Mostafa Kamel',
    company: 'Kamel Real Estate',
    source: 'OUTBOUND',
    owner: 'sales.a',
    next: 4,
  },
  {
    name: 'Youssef Nabil',
    company: 'Nabil & Partners Law',
    source: 'REFERRAL',
    owner: 'sales.b',
    next: -2,
    notes: 'Follow-up is overdue: promised a call last week.',
  },
  {
    name: 'Dina Samir',
    company: 'Samir Tours',
    source: 'PARTNER',
    owner: 'sales.b',
    phone: '+20 111 555 0177',
  },
  {
    name: 'Hossam Wahba',
    company: 'Wahba Engineering',
    source: 'WEBSITE',
    owner: 'sales.a',
    next: 7,
  },
  {
    name: 'Mariam Fouad',
    company: 'Fouad Pharmacies',
    source: 'EVENT',
    owner: 'sales.manager',
    next: 3,
    notes: 'Loyalty app — needs an iOS and Android estimate.',
  },
  { name: 'Sherif Lotfy', source: 'OTHER', owner: 'sales.manager' },
  { name: 'Aya Gaber', company: 'Gaber Furniture', source: 'SOCIAL', owner: 'sales.a', next: 10 },
  {
    name: 'Khaled Mahmoud',
    company: 'Mahmoud International Trading, Import & Export Holding Company',
    source: 'OUTBOUND',
    owner: 'sales.b',
    notes: 'Edge case: a very long company name that must wrap without breaking the layout.',
  },
  {
    name: 'Nadia Wassef',
    company: 'Wassef Architecture',
    source: 'REFERRAL',
    owner: 'sales.a',
    next: 0,
  },
  {
    name: 'Tamer Shawky',
    company: 'Shawky Auto Parts',
    source: 'WEBSITE',
    owner: 'sales.b',
    next: -1,
  },
  { name: 'Heba Mounir', company: 'Mounir Language School', source: 'EVENT', owner: 'sales.a' },
  {
    name: 'Ramy Saad',
    company: 'Saad Fitness Studios',
    source: 'SOCIAL',
    owner: 'sales.b',
    next: 2,
  },
  { name: 'Ingy Farouk', company: 'Farouk Interiors', source: 'PARTNER', owner: 'sales.manager' },
  {
    name: 'Bassem Tawfik',
    company: 'Tawfik Agro Exports',
    source: 'OUTBOUND',
    owner: 'sales.a',
    next: 14,
  },
  {
    name: 'Sara Hegazy',
    source: 'WEBSITE',
    owner: 'sales.b',
    notes: 'No company yet: freelance photographer asking about a portfolio site.',
  },
  {
    name: 'Ziad Amin',
    company: 'Amin Coffee Roasters',
    source: 'REFERRAL',
    owner: 'sales.a',
    next: 5,
  },
];

/** A small real PDF, so deliverables can be downloaded and opened in the demo. */
function demoPdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text(title).moveDown();
    doc.fontSize(11).fillColor('#555').text('ClientFlow demo — fictional content.').moveDown();
    doc.fillColor('#000');
    for (const l of lines) doc.text(`• ${l}`).moveDown(0.4);
    doc.end();
  });
}

export async function seedDemo(
  db: Db,
  api: { base: string; origin: string },
  log: (msg: string) => void = () => {},
): Promise<DemoCredential[]> {
  const creds: DemoCredential[] = [];
  const pw = () => generateToken(18);

  // 1. Owner through the real bootstrap, then the demo flag (the only direct writes).
  const ownerPassword = pw();
  const owner = {
    email: `owner@${DEMO_DOMAIN}`,
    name: 'Mona Adel',
    role: 'OWNER',
    password: ownerPassword,
  };
  const { agencyId } = await bootstrapOwner(db, {
    agencyName: 'Lumen Digital Studio (demo)',
    ownerName: owner.name,
    ownerEmail: owner.email,
    password: ownerPassword,
  });
  await db.agency.update({ where: { id: agencyId }, data: { isDemo: true } });
  creds.push(owner);

  const as: Partial<Record<Who, DemoClient>> = {};
  as.owner = await DemoClient.signIn(api.base, api.origin, owner.email, ownerPassword);
  const ownerApi = as.owner;
  await ownerApi.patch('/agency', {
    version: 1,
    name: 'Lumen Digital Studio (demo)',
    defaultCurrency: 'EGP',
    timeZone: 'Africa/Cairo',
    workingDays: [0, 1, 2, 3, 4],
    contactEmail: `hello@${DEMO_DOMAIN}`,
    phone: '+20 2 5550 1000',
    address: '12 Fictional Street, Cairo (demo address)',
  });

  // 2. Staff join through invitations, as a real team would. Accepting signs the person in, so
  // each acceptance uses a fresh anonymous client.
  const ids: Partial<Record<Who, string>> = {};
  for (const s of STAFF) {
    const email = `${s.key}@${DEMO_DOMAIN}`;
    const inv = await ownerApi.post<InvitationCreated>('/invitations', { email, role: s.role });
    const password = pw();
    const token = new URL(inv.acceptUrl).hash.replace('#token=', '');
    await (
      await DemoClient.anonymous(api.base, api.origin)
    ).post('/invitations/accept', { token, name: s.name, password });
    as[s.key] = await DemoClient.signIn(api.base, api.origin, email, password);
    creds.push({ email, role: s.role, name: s.name, password });
  }
  for (const u of await db.user.findMany({ where: { agencyId } })) {
    const key = u.role === 'OWNER' ? 'owner' : u.emailNorm.split('@')[0];
    ids[key as Who] = u.id;
  }
  const c = (who: Who) => as[who]!;
  log(`team: ${creds.length} people`);

  // 3. Service catalog and internal cost rates (Owner and Admin only).
  const services: Record<string, string> = {};
  for (const [name, unit, rate, currency, description] of [
    ['Discovery workshop', 'day', '12000.00', 'EGP', 'Goals, users and scope with your team.'],
    ['UX/UI design', 'day', '9500.00', 'EGP', undefined],
    ['Web development', 'hour', '850.00', 'EGP', undefined],
    ['Mobile app development', 'hour', '1100.00', 'EGP', undefined],
    ['Dashboard development', 'hour', '45.00', 'USD', 'Data dashboards and integrations.'],
    ['Monthly maintenance', 'month', '250.00', 'USD', 'Updates, monitoring and small fixes.'],
  ] as const) {
    const s = await c('admin').post<{ id: string }>('/services', {
      name,
      unit,
      rate,
      currency,
      ...(description ? { description } : {}),
    });
    services[name] = s.id;
  }
  for (const [who, hourly] of [
    ['pm', '400.00'],
    ['member.a', '300.00'],
    ['member.b', '320.00'],
  ] as const) {
    await c('admin').post(`/users/${ids[who]}/cost-rates`, {
      hourly,
      currency: 'EGP',
      effectiveFrom: day(-60),
    });
  }

  // 4. Leads, each created by the salesperson who owns it.
  const contacts: ContactDetail[] = [];
  for (const [i, l] of LEADS.entries()) {
    const slug = l.name.toLowerCase().replace(/[^a-z]+/g, '.');
    contacts.push(
      await c(l.owner).post<ContactDetail>('/contacts', {
        fullName: l.name,
        email: `${slug}@${i < 3 ? 'client.' : ''}example.test`,
        ...(l.phone ? { phone: l.phone } : {}),
        ...(l.company ? { companyName: l.company } : {}),
        source: l.source,
        ...(l.notes ? { notes: l.notes } : {}),
        ...(l.next !== undefined ? { nextActionAt: at(l.next) } : {}),
      }),
    );
  }
  log(`contacts: ${contacts.length}`);

  // 5. Deals across the pipeline (10).
  const pipeline = await ownerApi.get<PipelineSummary>('/pipelines/default');
  const stage = (n: number) => pipeline.stages[Math.min(n, pipeline.stages.length - 1)]!.id;
  const DEALS: Array<{
    lead: number;
    title: string;
    amount: string;
    currency: string;
    stage: number;
    next?: [string, number];
  }> = [
    { lead: 0, title: 'Online ordering website', amount: '185000.00', currency: 'EGP', stage: 3 },
    { lead: 1, title: 'Fleet tracking dashboard', amount: '42000.00', currency: 'USD', stage: 3 },
    { lead: 2, title: 'Clinic booking app', amount: '320000.00', currency: 'EGP', stage: 3 },
    {
      lead: 3,
      title: 'Fashion online store',
      amount: '275000.00',
      currency: 'EGP',
      stage: 3,
      next: ['Internal review of the proposal', 1],
    },
    {
      lead: 4,
      title: 'Property listings portal',
      amount: '97500.50',
      currency: 'EGP',
      stage: 0,
      next: ['Qualify budget', 4],
    },
    {
      lead: 5,
      title: 'Law firm website refresh',
      amount: '60000.00',
      currency: 'EGP',
      stage: 1,
      next: ['Call back about timing', -2],
    },
    {
      lead: 7,
      title: 'Engineering project tracker',
      amount: '18500.00',
      currency: 'USD',
      stage: 2,
      next: ['Discovery call with the ops lead', 0],
    },
    {
      lead: 8,
      title: 'Pharmacy loyalty app',
      amount: '410000.00',
      currency: 'EGP',
      stage: 2,
      next: ['Send rough estimate', 3],
    },
    {
      lead: 12,
      title: 'Architecture portfolio site',
      amount: '45000.00',
      currency: 'EGP',
      stage: 1,
    },
    { lead: 6, title: 'Tour packages site', amount: '18500.00', currency: 'USD', stage: 1 },
  ];
  const deals: DealDetail[] = [];
  for (const d of DEALS) {
    const lead = LEADS[d.lead]!;
    deals.push(
      await c(lead.owner).post<DealDetail>('/deals', {
        contactId: contacts[d.lead]!.id,
        title: d.title,
        amount: d.amount,
        currency: d.currency,
        stageId: stage(d.stage),
        expectedCloseOn: day(30),
        ...(d.next ? { nextStep: d.next[0], nextStepAt: at(d.next[1]) } : {}),
      }),
    );
  }
  const lost = deals[9]!;
  await c('sales.b').post(`/deals/${lost.id}/close`, {
    outcome: 'LOST',
    version: lost.version,
    reason: 'Chose a template platform for now.',
  });
  log(`deals: ${deals.length}`);

  // 6. Client organizations with one portal user each (separate organizations prove isolation).
  // Portal access is managed by the sales manager (portal.manage).
  const clients: Array<{ orgId: string; userId: string; api: DemoClient }> = [];
  for (const i of [0, 1, 2]) {
    const lead = LEADS[i]!;
    const org = await c('sales.manager').post<ClientOrgDetail>(
      `/contacts/${contacts[i]!.id}/client-org`,
      {
        name: lead.company!,
      },
    );
    const email = `client.${i + 1}@portal.${DEMO_DOMAIN}`;
    const inv = await c('sales.manager').post<PortalInvitationCreated>(
      `/client-orgs/${org.id}/invitations`,
      { email },
    );
    const password = pw();
    const token = new URL(inv.acceptUrl).hash.replace('#token=', '');
    await (
      await DemoClient.anonymous(api.base, api.origin)
    ).post('/invitations/accept', { token, name: lead.name, password });
    const user = await db.user.findFirstOrThrow({ where: { agencyId, emailNorm: email } });
    clients.push({
      orgId: org.id,
      userId: user.id,
      api: await DemoClient.signIn(api.base, api.origin, email, password),
    });
    creds.push({ email, role: 'CLIENT', name: `${lead.name} (${lead.company})`, password });
  }

  // 7. Proposals: drafted by sales, approved by the manager, decided by the client in the portal.
  type Line = [service: string, quantity: string, unitPrice: string, unit: string];
  async function saveDraft(
    who: Who,
    proposalId: string,
    content: {
      title: string;
      summary: string;
      milestones: string;
      items: Line[];
      discount?: string;
    },
  ) {
    const fresh = await c(who).get<ProposalDetail>(`/proposals/${proposalId}`);
    return c(who).put<ProposalDetail>(`/proposals/${proposalId}/draft`, {
      version: fresh.current.version,
      title: content.title,
      summary: content.summary,
      inclusions: 'Design, development, testing and launch support for the lines below.',
      exclusions: 'Hosting fees, paid plugins and content writing.',
      assumptions: 'The client sends content and feedback within 3 working days.',
      milestones: content.milestones,
      paymentTerms: '30% on acceptance, 40% at design approval, 30% at launch.',
      terms: 'Operational approval of scope and price (fictional demo terms).',
      internalNotes: 'Margin target 35%. Internal only: never shown to the client.',
      expiresOn: day(30),
      discountPercent: content.discount ?? '0',
      taxRatePercent: '14',
      taxLabel: 'VAT',
      items: content.items.map(([name, quantity, unitPrice, unit]) => ({
        serviceId: services[name] ?? null,
        name,
        unit,
        quantity,
        unitPrice,
      })),
    });
  }
  async function submitAndApprove(who: Who, proposalId: string) {
    const p = await c(who).get<ProposalDetail>(`/proposals/${proposalId}`);
    const sub = await c(who).post<ProposalDetail>(`/proposals/${proposalId}/submit`, {
      version: p.current.version,
    });
    return c('sales.manager').post<ProposalDetail>(`/proposals/${proposalId}/review`, {
      version: sub.current.version,
      decision: 'APPROVE',
      comment: 'Scope and margin look right.',
    });
  }
  async function send(who: Who, p: ProposalDetail) {
    return c(who).post<ProposalDetail>(`/proposals/${p.id}/send`, { version: p.current.version });
  }
  async function clientDecides(
    client: DemoClient,
    proposalId: string,
    decision: 'ACCEPT' | 'REQUEST_CHANGES',
    comment?: string,
  ) {
    const view = await client.get<PortalProposalDetail>(`/portal/proposals/${proposalId}`);
    await client.post(`/portal/proposals/${proposalId}/decision`, {
      decision,
      contentHash: view.current.contentHash,
      ...(comment ? { comment } : {}),
    });
  }

  // Nile Bakery: v1 sent, the client asks for changes, v2 is accepted.
  const bakery = await c('sales.a').post<ProposalDetail>('/proposals', { dealId: deals[0]!.id });
  await saveDraft('sales.a', bakery.id, {
    title: 'Online ordering website',
    summary: 'An ordering site with pickup time slots and an admin panel for the shop team.',
    milestones: 'Design — 2 weeks\nBuild — 4 weeks\nLaunch — 1 week',
    items: [
      ['Discovery workshop', '1', '12000.00', 'day'],
      ['UX/UI design', '6', '9500.00', 'day'],
      ['Web development', '120', '850.00', 'hour'],
    ],
  });
  await send('sales.a', await submitAndApprove('sales.a', bakery.id));
  await clientDecides(
    clients[0]!.api,
    bakery.id,
    'REQUEST_CHANGES',
    'Could you add a digital stamp card for regular customers?',
  );
  const bakeryV1 = await c('sales.a').get<ProposalDetail>(`/proposals/${bakery.id}`);
  await c('sales.a').post(`/proposals/${bakery.id}/revise`, { version: bakeryV1.version });
  await saveDraft('sales.a', bakery.id, {
    title: 'Online ordering website with stamp card',
    summary: 'Ordering with pickup slots, an admin panel and a digital stamp card.',
    milestones: 'Design — 2 weeks\nBuild — 5 weeks\nLaunch — 1 week',
    items: [
      ['Discovery workshop', '1', '12000.00', 'day'],
      ['UX/UI design', '6', '9500.00', 'day'],
      ['Web development', '140', '850.00', 'hour'],
    ],
    discount: '5',
  });
  await send('sales.a', await submitAndApprove('sales.a', bakery.id));
  await clientDecides(clients[0]!.api, bakery.id, 'ACCEPT');

  // Delta Logistics and Haddad Dental: accepted first time.
  const fleet = await c('sales.b').post<ProposalDetail>('/proposals', { dealId: deals[1]!.id });
  await saveDraft('sales.b', fleet.id, {
    title: 'Fleet tracking dashboard',
    summary: 'Live map of 40 vans, delivery status and a weekly performance report.',
    milestones: 'Discovery — 1 week\nDashboard — 6 weeks\nRollout — 1 week',
    items: [
      ['Dashboard development', '780', '45.00', 'hour'],
      ['Monthly maintenance', '6', '250.00', 'month'],
    ],
  });
  await send('sales.b', await submitAndApprove('sales.b', fleet.id));
  await clientDecides(clients[1]!.api, fleet.id, 'ACCEPT');

  const clinic = await c('sales.a').post<ProposalDetail>('/proposals', { dealId: deals[2]!.id });
  await saveDraft('sales.a', clinic.id, {
    title: 'Clinic booking app',
    summary: 'Patients book, move and cancel appointments across three branches.',
    milestones: 'Design — 3 weeks\nApp build — 8 weeks\nPilot at one branch — 2 weeks',
    items: [
      ['UX/UI design', '10', '9500.00', 'day'],
      ['Mobile app development', '180', '1100.00', 'hour'],
    ],
  });
  await send('sales.a', await submitAndApprove('sales.a', clinic.id));
  await clientDecides(clients[2]!.api, clinic.id, 'ACCEPT');

  // Sayed Fashion: submitted, waiting for the manager's review.
  const fashion = await c('sales.b').post<ProposalDetail>('/proposals', { dealId: deals[3]!.id });
  await saveDraft('sales.b', fashion.id, {
    title: 'Fashion online store',
    summary: 'Move the Instagram shop to an online store with size guides and returns.',
    milestones: 'Design — 3 weeks\nStore build — 6 weeks',
    items: [
      ['UX/UI design', '8', '9500.00', 'day'],
      ['Web development', '200', '850.00', 'hour'],
    ],
  });
  const fp = await c('sales.b').get<ProposalDetail>(`/proposals/${fashion.id}`);
  await c('sales.b').post(`/proposals/${fashion.id}/submit`, { version: fp.current.version });
  log('proposals: 4');

  // 8. Projects from the three won deals, managed by the PM, shared with each client.
  const MILESTONE_PLAN: Array<Array<[number, 'PLANNED' | 'IN_PROGRESS' | 'DONE']>> = [
    [
      [5, 'IN_PROGRESS'],
      [33, 'PLANNED'],
      [49, 'PLANNED'],
    ],
    [
      [-14, 'DONE'],
      [28, 'IN_PROGRESS'],
      [56, 'PLANNED'],
    ],
    [
      [-3, 'IN_PROGRESS'],
      [70, 'PLANNED'],
      [91, 'PLANNED'],
    ],
  ];
  const projects: ProjectDetail[] = [];
  for (const [i, title, due] of [
    [0, 'Nile Bakery — ordering website', 49],
    [1, 'Delta Logistics — fleet dashboard', 56],
    [2, 'Haddad Dental — booking app', 91],
  ] as const) {
    const { project } = await c('owner').post<ConvertResult>(
      `/deals/${deals[i]!.id}/convert-to-project`,
      { managerId: ids.pm!, title, startOn: day(-21), dueOn: day(due) },
      idem(),
    );
    for (const m of ['member.a', 'member.b'] as const) {
      await c('pm').post(`/projects/${project.id}/members`, { userId: ids[m]! });
    }
    await c('pm').post(`/projects/${project.id}/shares`, { userId: clients[i]!.userId });
    let detail = await c('pm').get<ProjectDetail>(`/projects/${project.id}`);
    if (detail.milestoneList.length === 0) {
      for (const [t, d] of [
        ['Design', 7],
        ['Build', 35],
        ['Launch', due],
      ] as const) {
        await c('pm').post(`/projects/${project.id}/milestones`, { title: t, dueOn: day(d) });
      }
    }
    detail = await c('pm').get<ProjectDetail>(`/projects/${project.id}`);
    if (detail.state === 'PLANNED') {
      detail = await c('pm').post<ProjectDetail>(`/projects/${project.id}/state`, {
        version: detail.version,
        state: 'ACTIVE',
      });
      detail = await c('pm').get<ProjectDetail>(`/projects/${project.id}`);
    }
    // Dates and progress, so the timeline reads like a project three weeks in (the clinic's
    // first milestone is overdue on purpose).
    const plan = MILESTONE_PLAN[i]!;
    for (const [n, m] of detail.milestoneList.entries()) {
      const [inDays, status] = plan[Math.min(n, plan.length - 1)]!;
      await c('pm').patch(`/projects/${project.id}/milestones/${m.id}`, {
        version: m.version,
        dueOn: day(inDays),
        status,
      });
    }
    detail = await c('pm').get<ProjectDetail>(`/projects/${project.id}`);
    projects.push(detail);
  }
  log(`projects: ${projects.length}`);

  // 9. Tasks (25, plus one the accepted change request adds) with mixed status, priorities and some overdue, plus logged time.
  const TASKS: Array<
    [
      project: number,
      title: string,
      who: Who,
      due: number,
      status: string,
      priority: string,
      est: number,
      logged?: number,
    ]
  > = [
    [0, 'Kick-off call and content checklist', 'pm', -18, 'DONE', 'MEDIUM', 60, 75],
    [0, 'Sitemap and user flows', 'member.a', -14, 'DONE', 'HIGH', 480, 420],
    [0, 'Homepage design', 'member.b', -9, 'DONE', 'HIGH', 720, 780],
    [0, 'Menu and ordering flow prototype', 'member.b', -2, 'IN_REVIEW', 'HIGH', 600, 540],
    [0, 'Pickup slot rules with the shop team', 'pm', -3, 'BLOCKED', 'URGENT', 120],
    [0, 'Product catalogue import', 'member.a', 5, 'IN_PROGRESS', 'MEDIUM', 360, 150],
    [0, 'Checkout and order emails', 'member.a', 12, 'TODO', 'HIGH', 600],
    [0, 'Admin panel: orders list', 'member.a', 19, 'TODO', 'MEDIUM', 480],
    [0, 'Stamp card logic', 'member.b', 26, 'TODO', 'MEDIUM', 420],
    [0, 'Launch checklist and handover', 'pm', 45, 'TODO', 'LOW', 120],
    [1, 'Discovery with the operations lead', 'pm', -16, 'DONE', 'HIGH', 180, 200],
    [1, 'Data sources and GPS feed review', 'member.a', -10, 'DONE', 'HIGH', 480, 510],
    [1, 'Dashboard wireframes', 'member.b', -4, 'IN_REVIEW', 'HIGH', 600, 600],
    [1, 'Live map prototype', 'member.a', -1, 'IN_PROGRESS', 'URGENT', 900, 480],
    [1, 'Delivery status rules', 'member.b', 6, 'TODO', 'MEDIUM', 360],
    [1, 'Weekly performance report', 'member.b', 20, 'TODO', 'MEDIUM', 480],
    [1, 'Access roles for dispatchers', 'member.a', 27, 'TODO', 'LOW', 240],
    [1, 'Rollout training session', 'pm', 50, 'TODO', 'LOW', 120],
    [1, 'Load test with 40 vans', 'member.a', 40, 'TODO', 'MEDIUM', 300],
    [2, 'Branch workflow interviews', 'pm', -12, 'DONE', 'HIGH', 240, 260],
    [2, 'Booking flow mockups', 'member.b', 3, 'IN_PROGRESS', 'HIGH', 900, 360],
    [2, 'Appointment rules per branch', 'member.a', -5, 'IN_PROGRESS', 'URGENT', 300, 120],
    [2, 'Reminder messages copy', 'member.b', 15, 'TODO', 'LOW', 120],
    [2, 'App store accounts checklist', 'pm', 21, 'TODO', 'MEDIUM', 60],
    [2, 'Pilot plan for one branch', 'pm', 70, 'TODO', 'MEDIUM', 180],
  ];
  const tasks: TaskView[] = [];
  for (const [pi, title, who, due, status, priority, est, logged] of TASKS) {
    const project = projects[pi]!;
    const milestone =
      project.milestoneList[due < 0 ? 0 : due < 30 ? 1 : project.milestoneList.length - 1] ??
      project.milestoneList[0];
    let t = await c('pm').post<TaskView>(`/projects/${project.id}/tasks`, {
      title,
      assigneeId: ids[who]!,
      milestoneId: milestone?.id ?? null,
      dueOn: day(due),
      priority,
      estimateMinutes: est,
    });
    if (logged) {
      await c(who).post(`/tasks/${t.id}/time`, {
        workedOn: day(Math.min(due, -1)),
        minutes: Math.min(logged, 480),
        billable: true,
        note: 'Demo time entry.',
      });
      if (logged > 480) {
        await c(who).post(`/tasks/${t.id}/time`, {
          workedOn: day(Math.min(due, -1) - 1),
          minutes: logged - 480,
          billable: true,
        });
      }
    }
    const path =
      {
        IN_PROGRESS: ['IN_PROGRESS'],
        BLOCKED: ['IN_PROGRESS', 'BLOCKED'],
        IN_REVIEW: ['IN_PROGRESS', 'IN_REVIEW'],
        DONE: ['IN_PROGRESS', 'IN_REVIEW', 'DONE'],
      }[status] ?? [];
    for (const s of path) {
      t = await c(who).post<TaskView>(`/tasks/${t.id}/status`, { version: t.version, status: s });
    }
    tasks.push(t);
  }
  log(`tasks: ${tasks.length}`);

  // 10. Change requests: accepted, waiting for the client, and declined.
  async function change(
    pi: number,
    input: {
      title: string;
      description: string;
      scope: string;
      work: string;
      hours: number;
      price: string;
    },
    outcome: 'ACCEPT' | 'REJECT' | 'PENDING',
  ) {
    const project = projects[pi]!;
    let ch = await c('pm').post<ChangeDetail>(`/projects/${project.id}/changes`, {
      title: input.title,
      description: input.description,
      justification: 'Requested by the client during a review call.',
    });
    ch = await c('pm').put<ChangeDetail>(`/changes/${ch.id}/draft`, {
      version: ch.version,
      scope: input.scope,
      workItems: input.work,
      estimateMinutes: input.hours * 60,
      price: input.price,
    });
    ch = await c('pm').post<ChangeDetail>(`/changes/${ch.id}/submit`, { version: ch.version });
    ch = await c('owner').post<ChangeDetail>(`/changes/${ch.id}/review`, {
      version: ch.version,
      decision: 'APPROVE',
    });
    ch = await c('pm').post<ChangeDetail>(`/changes/${ch.id}/send`, { version: ch.version });
    if (outcome !== 'PENDING') {
      const client = clients[pi]!.api;
      const view = await client.get<{ versions: Array<{ contentHash: string | null }> }>(
        `/portal/changes/${ch.id}`,
      );
      const hash = view.versions
        .map((v) => v.contentHash)
        .filter(Boolean)
        .at(-1)!;
      await client.post(`/portal/changes/${ch.id}/decision`, {
        decision: outcome,
        contentHash: hash,
        ...(outcome === 'REJECT' ? { reason: 'Not in this budget year; maybe next phase.' } : {}),
      });
    }
    return ch;
  }
  await change(
    0,
    {
      title: 'Arabic version of the menu',
      description: 'Show the menu and checkout in Arabic as well as English.',
      scope: 'Right-to-left layout for menu and checkout; translated labels.',
      work: 'Arabic menu and checkout (right-to-left)',
      hours: 32,
      price: '27200.00',
    },
    'ACCEPT',
  );
  await change(
    1,
    {
      title: 'Push alerts for late deliveries',
      description: 'Alert the dispatcher when a van is more than 20 minutes late.',
      scope: 'Lateness rule, alert settings and a notification log.',
      work: 'Late-delivery alerts',
      hours: 40,
      price: '1800.00',
    },
    'PENDING',
  );
  await change(
    2,
    {
      title: 'Online deposit payments',
      description: 'Let patients pay a deposit when booking.',
      scope: 'Payment step in booking, receipts and refunds flow.',
      work: 'Deposit payment step',
      hours: 60,
      price: '66000.00',
    },
    'REJECT',
  );
  log('changes: 3');

  // 11. Deliverables with real PDF files: approved, revision requested, awaiting review, draft.
  async function deliverable(
    pi: number,
    title: string,
    lines: string[],
    outcome: 'APPROVE' | 'REQUEST_REVISION' | 'PENDING' | 'DRAFT',
  ) {
    const project = projects[pi]!;
    const pdf = await demoPdf(title, lines);
    const file = await c('member.b').upload<FileView>(
      `/projects/${project.id}/files`,
      `${title}.pdf`,
      'application/pdf',
      pdf,
    );
    let d = await c('pm').post<DeliverableDetail>(`/projects/${project.id}/deliverables`, {
      title,
      description: lines[0],
      reviewDueOn: day(outcome === 'PENDING' ? -1 : 5),
    });
    d = await c('pm').post<DeliverableDetail>(`/deliverables/${d.id}/versions`, {
      fileId: file.id,
      note: 'First version for review.',
    });
    if (outcome === 'DRAFT') return d;
    d = await c('pm').post<DeliverableDetail>(`/deliverables/${d.id}/publish`, {
      version: d.version,
    });
    if (outcome !== 'PENDING') {
      const latest = d.versions.at(-1)!;
      await clients[pi]!.api.post(`/portal/deliverables/${d.id}/decision`, {
        versionId: latest.id,
        decision: outcome,
        ...(outcome === 'REQUEST_REVISION'
          ? { reason: 'Please make the order button larger on phones.' }
          : {}),
      });
    }
    return d;
  }
  await deliverable(
    0,
    'Homepage design',
    ['Hero with today’s specials', 'Pickup slot picker', 'Footer with branches'],
    'APPROVE',
  );
  await deliverable(
    0,
    'Menu and ordering flow prototype',
    ['Menu categories', 'Cart and pickup time', 'Order confirmation'],
    'REQUEST_REVISION',
  );
  await deliverable(
    1,
    'Dashboard wireframes',
    ['Live map', 'Delivery status table', 'Weekly report'],
    'PENDING',
  );
  await deliverable(
    2,
    'Booking flow mockups',
    ['Choose branch and doctor', 'Pick a time', 'Confirm and reminders'],
    'DRAFT',
  );
  log('deliverables: 4');

  // 12. Comments between the client and the team on the revision request.
  const bakeryDeliverables = await c('pm').get<{
    deliverables: Array<{ id: string; title: string }>;
  }>(`/projects/${projects[0]!.id}/deliverables`);
  const flow = bakeryDeliverables.deliverables.find((x) => x.title.startsWith('Menu'));
  if (flow) {
    await clients[0]!.api.post('/portal/comments', {
      entityType: 'deliverable',
      entityId: flow.id,
      body: 'Most of our orders come from phones, so the button size matters a lot.',
    });
    await c('member.b').post(`/projects/${projects[0]!.id}/comments`, {
      entityType: 'deliverable',
      entityId: flow.id,
      body: 'Understood — a larger sticky order button is in the next version.',
    });
  }

  // 13. Invoices (5): paid, partly paid, overdue, issued and a draft.
  async function invoice(
    pi: number,
    lines: Array<[string, string, string]>,
    opts: { dueOn: string; issue: boolean; pay?: string; receivedOn?: string },
  ) {
    const project = projects[pi]!;
    let inv = await c('finance').post<InvoiceDetail>(
      '/invoices',
      { clientOrgId: clients[pi]!.orgId, projectId: project.id, dueOn: opts.dueOn },
      idem(),
    );
    inv = await c('finance').put<InvoiceDetail>(`/invoices/${inv.id}/draft`, {
      version: inv.version,
      dueOn: opts.dueOn,
      taxRatePercent: '14',
      terms: 'Bank transfer within 14 days (fictional demo terms).',
      items: lines.map(([description, quantity, unitPrice]) => ({
        description,
        quantity,
        unitPrice,
        source: 'OTHER',
      })),
    });
    if (!opts.issue) return inv;
    inv = await c('finance').post<InvoiceDetail>(`/invoices/${inv.id}/issue`, {
      version: inv.version,
    });
    inv = await c('finance').post<InvoiceDetail>(`/invoices/${inv.id}/publish`, {
      version: inv.version,
    });
    if (opts.pay) {
      await c('finance').post(
        `/invoices/${inv.id}/payments`,
        {
          amount: opts.pay,
          receivedOn: opts.receivedOn ?? day(-1),
          method: 'BANK_TRANSFER',
          reference: `DEMO-TRF-${inv.number ?? ''}`.slice(0, 40),
        },
        idem(),
      );
    }
    return inv;
  }
  await invoice(0, [['Deposit — 30% of the accepted proposal', '1', '62738.40']], {
    dueOn: day(-10),
    issue: true,
    pay: '71521.78',
    receivedOn: day(-12),
  });
  await invoice(0, [['Design approval — 40%', '1', '83651.20']], {
    dueOn: day(4),
    issue: true,
    pay: '50000.00',
    receivedOn: day(-1),
  });
  await invoice(1, [['Deposit — 30%', '1', '10980.00']], { dueOn: day(-6), issue: true });
  await invoice(2, [['Deposit — 30%', '1', '149400.00']], { dueOn: day(10), issue: true });
  await invoice(2, [['Design phase — 40%', '1', '199200.00']], { dueOn: day(40), issue: false });
  log('invoices: 5');

  // 14. Delta's project waits on the overdue deposit.
  const delta = await c('pm').get<ProjectDetail>(`/projects/${projects[1]!.id}`);
  await c('pm').post(`/projects/${delta.id}/state`, { version: delta.version, state: 'ON_HOLD' });

  return creds;
}
