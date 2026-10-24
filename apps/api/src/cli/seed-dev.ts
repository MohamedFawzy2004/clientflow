// Development-only seed with fictional data (ADR-010, spec §21). Refuses to run in production.
// Creates the owner (if the database is empty), extra staff users and sample leads.
// Generated passwords go to apps/api/.dev-credentials.local.json (gitignored) and are never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContactSource } from '@clientflow/contracts';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { bootstrapOwner } from '../modules/auth/bootstrap.js';
import { hashPassword } from '../lib/password.js';
import { normalizePhone } from '../lib/normalize.js';
import { generateToken } from '../lib/tokens.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('seed:dev refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const DOMAIN = 'clientflow.test'; // Reserved TLD: these addresses can never receive mail.

const STAFF: Array<{ key: string; name: string; role: Role }> = [
  { key: 'admin', name: 'Hana Adly', role: 'ADMIN' },
  { key: 'sales.manager', name: 'Karim Fathy', role: 'SALES_MANAGER' },
  { key: 'sales.a', name: 'Nour Salem', role: 'SALES' },
  { key: 'sales.b', name: 'Omar Zaki', role: 'SALES' },
  { key: 'pm', name: 'Yara Mansour', role: 'PM' },
  { key: 'finance', name: 'Tarek Habib', role: 'FINANCE' },
];

const LEADS: Array<{
  name: string;
  company?: string;
  source?: ContactSource;
  phone?: string;
  owner: string;
  days?: number;
  notes?: string;
}> = [
  {
    name: 'Salma Ibrahim',
    company: 'Nile Bakery Co.',
    source: 'REFERRAL',
    phone: '+20 100 555 0101',
    owner: 'sales.a',
    days: 2,
    notes: 'Wants an online ordering site before Ramadan.',
  },
  {
    name: 'Ahmed Rostom',
    company: 'Delta Logistics',
    source: 'WEBSITE',
    owner: 'sales.a',
    days: -1,
    notes: 'Asked for a fleet tracking dashboard quote.',
  },
  {
    name: 'Laila Haddad',
    company: 'Haddad Dental Clinics',
    source: 'EVENT',
    phone: '+20 122 555 0144',
    owner: 'sales.a',
  },
  {
    name: 'Mostafa Kamel',
    company: 'Kamel Real Estate',
    source: 'OUTBOUND',
    owner: 'sales.a',
    days: 5,
  },
  {
    name: 'Rana El-Sayed',
    company: 'Sayed Fashion House',
    source: 'SOCIAL',
    owner: 'sales.b',
    days: 1,
    notes: 'Instagram shop migration to a full e-commerce site.',
  },
  { name: 'Youssef Nabil', company: 'Nabil & Partners Law', source: 'REFERRAL', owner: 'sales.b' },
  {
    name: 'Dina Samir',
    company: 'Samir Tours',
    source: 'PARTNER',
    phone: '+20 111 555 0177',
    owner: 'sales.b',
    days: -3,
  },
  {
    name: 'Hossam Wahba',
    company: 'Wahba Engineering',
    source: 'WEBSITE',
    owner: 'sales.b',
    days: 7,
  },
  {
    name: 'Mariam Fouad',
    company: 'Fouad Pharmacies',
    source: 'EVENT',
    owner: 'sales.manager',
    days: 3,
    notes: 'Loyalty app — needs iOS and Android estimate.',
  },
  { name: 'Sherif Lotfy', source: 'OTHER', owner: 'sales.manager' },
  { name: 'Aya Gaber', company: 'Gaber Furniture', source: 'SOCIAL', owner: 'sales.a', days: 10 },
  {
    name: 'Khaled Mahmoud — very long company name test',
    company: 'Mahmoud International Trading, Import & Export Holding Company',
    source: 'OUTBOUND',
    owner: 'sales.b',
    notes: 'Edge case: long names must wrap without breaking the layout.',
  },
];

const db = createDb(env.DATABASE_URL);
const credentials: Record<string, { email: string; role: Role; password: string }> = {};

try {
  let agency = await db.agency.findFirst();
  if (!agency) {
    const password = generateToken(18);
    await bootstrapOwner(db, {
      agencyName: 'Lumen Digital Studio',
      ownerName: 'Mona Adel',
      ownerEmail: `owner@${DOMAIN}`,
      password,
    });
    credentials.owner = { email: `owner@${DOMAIN}`, role: 'OWNER', password };
    agency = await db.agency.findFirstOrThrow();
  }

  const userIds: Record<string, string> = {};
  const owner = await db.user.findFirstOrThrow({ where: { agencyId: agency.id, role: 'OWNER' } });
  userIds.owner = owner.id;

  for (const staff of STAFF) {
    const email = `${staff.key}@${DOMAIN}`;
    const existing = await db.user.findUnique({
      where: { agencyId_emailNorm: { agencyId: agency.id, emailNorm: email } },
    });
    if (existing) {
      userIds[staff.key] = existing.id;
      continue;
    }
    const password = generateToken(18);
    const user = await db.user.create({
      data: {
        agencyId: agency.id,
        emailNorm: email,
        name: staff.name,
        role: staff.role,
        passwordHash: await hashPassword(password),
      },
    });
    userIds[staff.key] = user.id;
    credentials[staff.key] = { email, role: staff.role, password };
  }

  const existingLeads = await db.contact.count({ where: { agencyId: agency.id } });
  if (existingLeads === 0) {
    for (const [i, lead] of LEADS.entries()) {
      const ownerId = userIds[lead.owner]!;
      const ownerName = STAFF.find((s) => s.key === lead.owner)?.name ?? 'Owner';
      const slug = lead.name
        .toLowerCase()
        .split(' ')[0]!
        .replace(/[^a-z]/g, '');
      const contact = await db.contact.create({
        data: {
          agencyId: agency.id,
          ownerId,
          fullName: lead.name,
          emailNorm: `${slug}.${i}@example.test`,
          phone: lead.phone ?? null,
          phoneNorm: lead.phone ? normalizePhone(lead.phone) : null,
          companyName: lead.company ?? null,
          source: lead.source ?? null,
          notes: lead.notes ?? null,
          nextActionAt:
            lead.days === undefined ? null : new Date(Date.now() + lead.days * 86_400_000),
          createdAt: new Date(Date.now() - (LEADS.length - i) * 3_600_000),
        },
      });
      await db.activity.create({
        data: {
          agencyId: agency.id,
          actorId: ownerId,
          entityType: 'contact',
          entityId: contact.id,
          eventType: 'contact.created',
          summary: `Lead added by ${ownerName}`,
          createdAt: contact.createdAt,
          occurredAt: contact.createdAt,
        },
      });
    }
  }

  // Fictional deals across stages and two currencies (spec §21), added once.
  if ((await db.deal.count({ where: { agencyId: agency.id } })) === 0) {
    const pipeline = await db.pipeline.findFirstOrThrow({
      where: { agencyId: agency.id, isDefault: true },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    const contacts = await db.contact.findMany({
      where: { agencyId: agency.id },
      orderBy: { createdAt: 'asc' },
    });
    const day = 86_400_000;
    const DEALS: Array<{
      contact: number;
      title: string;
      amount: bigint;
      currency: string;
      stage: number;
      nextStep?: string;
      inDays?: number;
      lost?: string;
    }> = [
      {
        contact: 0,
        title: 'Online ordering website',
        amount: 18_500_000n,
        currency: 'EGP',
        stage: 3,
        nextStep: 'Send revised scope',
        inDays: 1,
      },
      {
        contact: 1,
        title: 'Fleet tracking dashboard',
        amount: 4_200_000n,
        currency: 'USD',
        stage: 2,
        nextStep: 'Discovery call with ops lead',
        inDays: -2,
      },
      { contact: 2, title: 'Clinic booking app', amount: 32_000_000n, currency: 'EGP', stage: 1 },
      {
        contact: 3,
        title: 'Property listings portal',
        amount: 9_750_050n,
        currency: 'EGP',
        stage: 0,
        nextStep: 'Qualify budget',
        inDays: 4,
      },
      {
        contact: 4,
        title: 'Fashion e-commerce migration',
        amount: 27_500_000n,
        currency: 'EGP',
        stage: 4,
        nextStep: 'Negotiate payment schedule',
        inDays: 0,
      },
      {
        contact: 6,
        title: 'Tour packages site',
        amount: 1_850_000n,
        currency: 'USD',
        stage: 1,
        lost: 'Chose a template platform',
      },
    ];
    for (const d of DEALS) {
      const contact = contacts[d.contact];
      if (!contact) continue;
      await db.deal.create({
        data: {
          agencyId: agency.id,
          contactId: contact.id,
          ownerId: contact.ownerId,
          pipelineId: pipeline.id,
          stageId: pipeline.stages[d.stage]!.id,
          title: d.title,
          amountMinor: d.amount,
          currency: d.currency,
          nextStep: d.nextStep ?? null,
          nextStepAt: d.inDays === undefined ? null : new Date(Date.now() + d.inDays * day),
          ...(d.lost
            ? {
                status: 'LOST' as const,
                closedAt: new Date(),
                closedById: contact.ownerId,
                lostReason: d.lost,
              }
            : {}),
        },
      });
    }
  }

  if (Object.keys(credentials).length > 0) {
    const file = fileURLToPath(new URL('../../.dev-credentials.local.json', import.meta.url));
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      previous = {};
    }
    writeFileSync(file, JSON.stringify({ ...previous, ...credentials }, null, 2) + '\n', {
      mode: 0o600,
    });
    console.log(
      `Wrote ${Object.keys(credentials).length} dev credential(s) to apps/api/.dev-credentials.local.json`,
    );
  }
  console.log(`Seed complete: ${STAFF.length + 1} users, ${await db.contact.count()} contacts.`);
} finally {
  await db.$disconnect();
}
