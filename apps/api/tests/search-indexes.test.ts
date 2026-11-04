// List and search indexes (backend audit, batch 4). One agency gets 5,000 contacts and 1,000 deals
// and fresh statistics, then the tests read the plan PostgreSQL picks for the exact SQL the
// services send. If one arm of the search OR has no index, PostgreSQL scans the whole table for all
// of them (the phone arm did exactly that before batch 4), which is what these tests catch.
import { contactListFiltersSchema, dealListQuerySchema } from '@clientflow/contracts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { listContacts } from '../src/modules/contacts/service.js';
import { listDeals } from '../src/modules/deals/service.js';
import type { AuthUser } from '../src/types/express.js';
import { resetDb, seedAgency, testDb, type SeededAgency } from './helpers.js';

const db = testDb();
const statements: Array<{ query: string; params: unknown[] }> = [];
/** A second client that records every statement it sends. */
const recording = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 2 }),
  log: [{ emit: 'event', level: 'query' }],
});
recording.$on('query', (e) => statements.push({ query: e.query, params: JSON.parse(e.params) }));
const plain = new pg.Client({ connectionString: process.env.DATABASE_URL });

let seeded: SeededAgency;
let owner: AuthUser;

beforeAll(async () => {
  await plain.connect();
  await resetDb();
  seeded = await seedAgency();
  const ownerId = seeded.users.salesA!.id;
  await db.contact.createMany({
    data: Array.from({ length: 5000 }, (_, i) => ({
      agencyId: seeded.agencyId,
      ownerId,
      fullName: `Person ${i} ${(i * 7919).toString(16).padStart(6, '0')}`,
      emailNorm: `p${i}@company${i % 500}.test`,
      companyName: `Company ${i % 500}`,
      phoneNorm: `+2010${String(i).padStart(8, '0')}`,
    })),
  });
  await db.contact.create({
    data: {
      agencyId: seeded.agencyId,
      ownerId,
      fullName: 'Mona Hassan',
      companyName: 'Nile Foods',
    },
  });
  const contacts = await db.contact.findMany({ select: { id: true }, take: 1000 });
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { agencyId: seeded.agencyId },
    include: { stages: { take: 1 } },
  });
  await db.deal.createMany({
    data: contacts.map((c, i) => ({
      agencyId: seeded.agencyId,
      ownerId,
      contactId: c.id,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      title: `Deal ${i}`,
      currency: 'EGP',
    })),
  });
  await plain.query('ANALYZE contacts');
  await plain.query('ANALYZE deals');
  const u = seeded.users.owner!;
  owner = {
    id: u.id,
    agencyId: seeded.agencyId,
    name: 'owner',
    emailNorm: u.email,
    role: u.role,
    clientOrgId: null,
  };
});
afterAll(async () => {
  await plain.end();
  await recording.$disconnect();
  await db.$disconnect();
});

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

/** Statements on `table` that one service call sent. */
async function sentFor(table: string, call: () => Promise<unknown>) {
  statements.length = 0;
  await call();
  return statements.filter((s) => s.query.includes(`FROM "public"."${table}"`));
}

/** The indexes, sequential scans and sorts in the plan PostgreSQL picks. */
async function planOf(s: { query: string; params: unknown[] }) {
  await plain.query('BEGIN');
  try {
    const { rows } = await plain.query(`EXPLAIN (FORMAT JSON) ${s.query}`, s.params);
    const used = new Set<string>();
    (function walk(n: PlanNode) {
      if (n['Index Name']) used.add(n['Index Name']);
      if (n['Node Type'].includes('Seq Scan')) used.add(`Seq Scan on ${n['Relation Name']}`);
      if (n['Node Type'] === 'Sort') used.add('Sort');
      (n.Plans ?? []).forEach(walk);
    })((rows[0] as { 'QUERY PLAN': Array<{ Plan: PlanNode }> })['QUERY PLAN'][0]!.Plan);
    return used;
  } finally {
    await plain.query('ROLLBACK');
  }
}

const TRIGRAM = [
  'contacts_full_name_trgm_idx',
  'contacts_company_name_trgm_idx',
  'contacts_email_norm_trgm_idx',
  'contacts_phone_norm_trgm_idx',
];

describe('search and list indexes', () => {
  it('the migration installed pg_trgm and the trigram indexes', async () => {
    const ext = await db.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    expect(ext).toHaveLength(1);
    const rows = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname = ANY(${[...TRIGRAM, 'deals_agency_id_updated_at_id_live_idx']})`;
    expect(rows.map((r) => r.indexname).sort()).toEqual(
      [...TRIGRAM, 'deals_agency_id_updated_at_id_live_idx'].sort(),
    );
    for (const r of rows.filter((x) => TRIGRAM.includes(x.indexname))) {
      expect(r.indexdef).toMatch(/USING gin \(\w+ gin_trgm_ops\)/);
    }
  });

  // At test size a scan is the cheaper plan, so this checks the cause directly: every column the
  // search matches with LIKE/ILIKE has a trigram index. (At 150k contacts the same SQL uses them:
  // apps/api/bench/search-ab.bench.ts.)
  it.each([
    ['a name', 'mona', ['full_name', 'email_norm', 'company_name']],
    // 3+ digits add a phone arm: it needs its own index, or the whole search scans.
    ['a term with digits', '0083a7', ['full_name', 'email_norm', 'company_name', 'phone_norm']],
    ['a phone number', '0000 4321', ['full_name', 'email_norm', 'company_name', 'phone_norm']],
  ])('contact search for %s has a trigram index for every arm', async (_label, q, columns) => {
    const indexed = new Set(
      (
        await db.$queryRaw<Array<{ indexdef: string }>>`
          SELECT indexdef FROM pg_indexes WHERE tablename = 'contacts' AND indexdef LIKE '%gin_trgm_ops%'`
      ).map((r) => /\((\w+) gin_trgm_ops\)/.exec(r.indexdef)![1]),
    );
    const sent = await sentFor('contacts', () =>
      listContacts(recording, owner, contactListFiltersSchema.parse({ q }), 'Africa/Cairo'),
    );
    expect(sent.length).toBeGreaterThanOrEqual(2); // the count and the page
    for (const s of sent) {
      const arms = [...s.query.matchAll(/"contacts"\."(\w+)"(?:::text)? I?LIKE/g)].map((m) => m[1]);
      expect(arms.sort()).toEqual([...columns].sort());
      for (const column of arms)
        expect([...indexed], `no trigram index on ${column}`).toContain(column);
    }
    // And the search still finds the right rows.
    const found = await listContacts(
      db,
      owner,
      contactListFiltersSchema.parse({ q }),
      'Africa/Cairo',
    );
    expect(found.total).toBeGreaterThanOrEqual(1);
  });

  it('the deals list reads pages in order from its index, without a sort', async () => {
    for (const page of [1, 3]) {
      const sent = await sentFor('deals', () =>
        listDeals(recording, owner, dealListQuerySchema.parse({ page })),
      );
      const pageQuery = sent.find((s) => /ORDER BY/.test(s.query))!;
      const used = await planOf(pageQuery);
      expect([...used]).toContain('deals_agency_id_updated_at_id_live_idx');
      expect([...used]).not.toContain('Sort');
      expect([...used]).not.toContain('Seq Scan on deals');
    }
  });
});
