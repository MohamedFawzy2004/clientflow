// CSV import of contacts and deals (FR-C10, FR-A07, ADR-060). Preview and commit run the same
// checks; commit runs them again inside the transaction, so the preview is advice and the server
// decides. The file is never stored: the run keeps its hash and counts.
import { createHash } from 'node:crypto';
import {
  can,
  CONTACT_SOURCE_LABELS,
  CONTACT_SOURCES,
  contactCreateSchema,
  CURRENCIES,
  IMPORT_FIELDS,
  parseMoneyToMinor,
  PERMISSIONS,
  zonedLocalToUtcIso,
  type ContactSource,
  type Currency,
  type ImportCommitResult,
  type ImportKind,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRunView,
  type ImportUndoResult,
  type importCommitSchema,
  type importPreviewSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors.js';
import { normalizeEmail, normalizePhone } from '../../lib/normalize.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { getDefaultPipeline } from '../pipelines/service.js';
import type { Tx } from '../projects/access.js';
import { MAX_CELL, parseCsv, sha256, suggestMapping } from './csv.js';

type PreviewInput = z.output<typeof importPreviewSchema>;
type CommitInput = z.output<typeof importCommitSchema>;

function requireImports(actor: AuthUser) {
  if (!can(actor.role, 'imports.run')) {
    throw forbidden('Only an owner, admin or sales manager can import data.');
  }
}

// ---------------------------------------------------------------------------
// Row checks
// ---------------------------------------------------------------------------

interface Context {
  actor: AuthUser;
  timeZone: string;
  defaultCurrency: Currency;
  /** Active staff who may own sales records, by normalized email. */
  owners: Map<string, string>;
  stages: Array<{ id: string; name: string }>;
  pipelineId: string;
}

interface CheckedRow extends ImportPreviewRow {
  /** Ready to insert (contacts or deals data), when status is not "error". */
  data?: Record<string, unknown>;
  /** Normalized keys used to find duplicates. */
  keys: string[];
}

const SOURCE_BY_TEXT = new Map<string, ContactSource>(
  CONTACT_SOURCES.flatMap((s) => [
    [s.toLowerCase(), s],
    [CONTACT_SOURCE_LABELS[s].toLowerCase(), s],
  ]),
);

/** Dates as YYYY-MM-DD (09:00 agency time) or YYYY-MM-DD HH:mm in the agency timezone. */
function parseLocalInstant(value: string, timeZone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value);
  if (!m) return null;
  return zonedLocalToUtcIso(`${m[1]}T${m[2] ?? '09:00'}`, timeZone);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function mapped(kind: ImportKind, headers: string[], mapping: Record<string, string | null>) {
  const index: Record<string, number> = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const header = mapping[field.key];
    if (header) index[field.key] = headers.indexOf(header);
  }
  return index;
}

function valuesOf(cells: string[], index: Record<string, number>) {
  const values: Record<string, string> = {};
  for (const [field, i] of Object.entries(index)) {
    if (i >= 0) values[field] = (cells[i] ?? '').trim();
  }
  return values;
}

function ownerFor(ctx: Context, value: string | undefined, errors: Record<string, string[]>) {
  if (!value) return ctx.actor.id;
  if (!can(ctx.actor.role, 'sales.reassign')) {
    errors.ownerEmail = ['Your role cannot import records for someone else.'];
    return ctx.actor.id;
  }
  const id = ctx.owners.get(normalizeEmail(value));
  if (!id) errors.ownerEmail = ['No active salesperson in your team has this email.'];
  return id ?? ctx.actor.id;
}

function checkContact(ctx: Context, line: number, v: Record<string, string>): CheckedRow {
  const errors: Record<string, string[]> = {};
  const parsed = contactCreateSchema.safeParse({
    fullName: v.fullName ?? '',
    email: v.email || undefined,
    phone: v.phone || undefined,
    companyName: v.companyName || undefined,
    notes: v.notes || undefined,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'row');
      (errors[key] ??= []).push(issue.message);
    }
  }
  let source: ContactSource | null = null;
  if (v.source) {
    source = SOURCE_BY_TEXT.get(v.source.toLowerCase()) ?? null;
    if (!source) {
      errors.source = [
        `Use one of: ${CONTACT_SOURCES.map((s) => CONTACT_SOURCE_LABELS[s]).join(', ')}.`,
      ];
    }
  }
  let lifecycle: 'LEAD' | 'CUSTOMER' = 'LEAD';
  if (v.lifecycle) {
    const l = v.lifecycle.toLowerCase();
    if (l === 'customer' || l === 'client') lifecycle = 'CUSTOMER';
    else if (l !== 'lead') errors.lifecycle = ['Use “Lead” or “Customer”.'];
  }
  let nextActionAt: string | null = null;
  if (v.nextActionAt) {
    nextActionAt = parseLocalInstant(v.nextActionAt, ctx.timeZone);
    if (!nextActionAt) errors.nextActionAt = ['Use a date like 2026-11-30 or 2026-11-30 14:00.'];
  }
  const ownerId = ownerFor(ctx, v.ownerEmail, errors);
  const emailNorm = parsed.success && parsed.data.email ? normalizeEmail(parsed.data.email) : null;
  const phoneNorm = parsed.success && parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
  const hasErrors = Object.keys(errors).length > 0;
  return {
    line,
    status: hasErrors ? 'error' : 'ready',
    values: v,
    errors,
    duplicateOf: null,
    keys: [...(emailNorm ? [`e:${emailNorm}`] : []), ...(phoneNorm ? [`p:${phoneNorm}`] : [])],
    ...(hasErrors || !parsed.success
      ? {}
      : {
          data: {
            fullName: parsed.data.fullName,
            emailNorm,
            phone: parsed.data.phone ?? null,
            phoneNorm,
            companyName: parsed.data.companyName ?? null,
            notes: parsed.data.notes ?? null,
            source,
            lifecycle,
            nextActionAt,
            ownerId,
          },
        }),
  };
}

function checkDeal(
  ctx: Context,
  line: number,
  v: Record<string, string>,
  contacts: Map<string, { id: string; fullName: string }>,
): CheckedRow {
  const errors: Record<string, string[]> = {};
  const title = v.title ?? '';
  if (!title) errors.title = ['Give the deal a name.'];
  else if (title.length > 200) errors.title = ['Name must be 200 characters or fewer.'];
  const contactKey = v.contactEmail ? normalizeEmail(v.contactEmail) : '';
  const contact = contactKey ? contacts.get(contactKey) : undefined;
  if (!contactKey) errors.contactEmail = ['Enter the email of the deal’s contact.'];
  else if (!contact) {
    errors.contactEmail = ['No contact has this email. Import or add the contact first.'];
  }
  const currency = (v.currency ? v.currency.toUpperCase() : ctx.defaultCurrency) as Currency;
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    errors.currency = [`Use one of: ${CURRENCIES.join(', ')}.`];
  }
  let amountMinor = 0n;
  if (v.amount && !errors.currency) {
    const minor = parseMoneyToMinor(v.amount, currency);
    if (minor === null)
      errors.amount = ['Enter an amount like 15000 or 15000.50, without a currency sign.'];
    else amountMinor = BigInt(minor);
  }
  let stage = ctx.stages[0];
  if (v.stage) {
    stage = ctx.stages.find((s) => s.name.toLowerCase() === v.stage!.toLowerCase());
    if (!stage)
      errors.stage = [`Use a stage of your pipeline: ${ctx.stages.map((s) => s.name).join(', ')}.`];
  }
  if (v.expectedCloseOn && !isDate(v.expectedCloseOn)) {
    errors.expectedCloseOn = ['Use a date like 2026-11-30.'];
  }
  if (v.nextStep && v.nextStep.length > 300) {
    errors.nextStep = ['Keep the next step under 300 characters.'];
  }
  let nextStepAt: string | null = null;
  if (v.nextStepAt) {
    nextStepAt = parseLocalInstant(v.nextStepAt, ctx.timeZone);
    if (!nextStepAt) errors.nextStepAt = ['Use a date like 2026-11-30 or 2026-11-30 14:00.'];
  }
  const ownerId = ownerFor(ctx, v.ownerEmail, errors);
  const hasErrors = Object.keys(errors).length > 0;
  return {
    line,
    status: hasErrors ? 'error' : 'ready',
    values: v,
    errors,
    duplicateOf: null,
    keys: contact ? [`d:${contact.id}:${title.toLowerCase()}`] : [],
    ...(hasErrors
      ? {}
      : {
          data: {
            title,
            contactId: contact!.id,
            amountMinor,
            currency,
            stageId: stage!.id,
            expectedCloseOn: v.expectedCloseOn || null,
            nextStep: v.nextStep || null,
            nextStepAt,
            ownerId,
          },
        }),
  };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

async function loadContext(db: Db | Tx, actor: AuthUser): Promise<Context> {
  const [agency, staff, pipeline] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } }),
    db.user.findMany({
      where: {
        agencyId: actor.agencyId,
        active: true,
        role: { in: [...PERMISSIONS['contacts.create']] },
      },
      select: { id: true, emailNorm: true },
    }),
    getDefaultPipeline(db, actor.agencyId),
  ]);
  return {
    actor,
    timeZone: agency.timezone,
    defaultCurrency: agency.defaultCurrency as Currency,
    owners: new Map(staff.map((u) => [u.emailNorm, u.id])),
    stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
    pipelineId: pipeline.id,
  };
}

interface Checked {
  preview: ImportPreview;
  rows: CheckedRow[];
  ctx: Context;
}

/** Parses, maps and checks every row, then marks duplicates of existing records and of earlier lines. */
async function check(db: Db | Tx, actor: AuthUser, input: PreviewInput): Promise<Checked> {
  const csv = parseCsv(input.csv);
  const fileSha256 = sha256(input.csv);
  const mapping = input.mapping ?? suggestMapping(input.kind, csv.headers);
  const fileErrors = [...csv.fileErrors];
  for (const [field, header] of Object.entries(mapping)) {
    if (header !== null && !csv.headers.includes(header)) {
      fileErrors.push(`The column “${header}” is not in the file.`);
    }
    if (!IMPORT_FIELDS[input.kind].some((f) => f.key === field)) {
      fileErrors.push(`“${field}” is not a field you can import.`);
    }
  }
  for (const f of IMPORT_FIELDS[input.kind]) {
    if (f.required && !mapping[f.key]) fileErrors.push(`Choose the column for “${f.label}”.`);
  }
  const ctx = await loadContext(db, actor);
  const empty: ImportPreview = {
    kind: input.kind,
    fileSha256,
    headers: csv.headers,
    mapping,
    rows: [],
    counts: { total: csv.rows.length, ready: 0, duplicate: 0, error: 0 },
    fileErrors,
  };
  if (fileErrors.length > 0) return { preview: empty, rows: [], ctx };

  const index = mapped(input.kind, csv.headers, mapping);
  const tooLong = (cells: string[]) => cells.some((c) => c.length > MAX_CELL);
  let rows: CheckedRow[];
  if (input.kind === 'contacts') {
    rows = csv.rows.map((r) => checkContact(ctx, r.line, valuesOf(r.cells, index)));
  } else {
    const emails = [
      ...new Set(
        csv.rows
          .map((r) => valuesOf(r.cells, index).contactEmail)
          .filter((e): e is string => Boolean(e))
          .map(normalizeEmail),
      ),
    ];
    const found = await db.contact.findMany({
      where: { agencyId: actor.agencyId, archivedAt: null, emailNorm: { in: emails } },
      select: { id: true, fullName: true, emailNorm: true },
      orderBy: { createdAt: 'asc' },
    });
    const contacts = new Map<string, { id: string; fullName: string }>();
    for (const c of found) if (!contacts.has(c.emailNorm!)) contacts.set(c.emailNorm!, c);
    rows = csv.rows.map((r) => checkDeal(ctx, r.line, valuesOf(r.cells, index), contacts));
  }
  csv.rows.forEach((r, i) => {
    if (tooLong(r.cells)) {
      rows[i]!.status = 'error';
      rows[i]!.errors.row = [`A cell is longer than ${MAX_CELL} characters.`];
      delete rows[i]!.data;
    }
  });

  await markDuplicates(db, actor, input.kind, rows);
  const counts = { total: rows.length, ready: 0, duplicate: 0, error: 0 };
  for (const r of rows) counts[r.status === 'ready' ? 'ready' : r.status] += 1;
  return {
    preview: {
      ...empty,
      counts,
      rows: rows.map(({ data: _d, keys: _k, ...row }) => row),
    },
    rows,
    ctx,
  };
}

async function markDuplicates(db: Db | Tx, actor: AuthUser, kind: ImportKind, rows: CheckedRow[]) {
  const existing = new Map<string, { id: string; label: string }>();
  if (kind === 'contacts') {
    const emails = rows.flatMap((r) =>
      r.keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2)),
    );
    const phones = rows.flatMap((r) =>
      r.keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2)),
    );
    // Importers read every contact of the agency (imports.run ⊂ contacts.read.all), so naming the
    // match reveals nothing they cannot open.
    const matches = await db.contact.findMany({
      where: {
        agencyId: actor.agencyId,
        archivedAt: null,
        OR: [{ emailNorm: { in: emails } }, { phoneNorm: { in: phones } }],
      },
      select: { id: true, fullName: true, emailNorm: true, phoneNorm: true },
    });
    for (const m of matches) {
      if (m.emailNorm) existing.set(`e:${m.emailNorm}`, { id: m.id, label: m.fullName });
      if (m.phoneNorm) existing.set(`p:${m.phoneNorm}`, { id: m.id, label: m.fullName });
    }
  } else {
    const contactIds = [
      ...new Set(rows.flatMap((r) => (r.data ? [r.data.contactId as string] : []))),
    ];
    const deals = await db.deal.findMany({
      where: {
        agencyId: actor.agencyId,
        archivedAt: null,
        status: 'OPEN',
        contactId: { in: contactIds },
      },
      select: { id: true, title: true, contactId: true },
    });
    for (const d of deals) {
      existing.set(`d:${d.contactId}:${d.title.toLowerCase()}`, { id: d.id, label: d.title });
    }
  }
  const firstLine = new Map<string, number>();
  for (const r of rows) {
    if (r.status === 'error') continue;
    const hit = r.keys.map((k) => existing.get(k)).find(Boolean);
    const earlier = r.keys.map((k) => firstLine.get(k)).find((l) => l !== undefined);
    if (hit) {
      r.status = 'duplicate';
      r.duplicateOf = { kind: 'existing', ...hit };
    } else if (earlier !== undefined) {
      r.status = 'duplicate';
      r.duplicateOf = { kind: 'line', line: earlier };
    }
    for (const k of r.keys) if (!firstLine.has(k)) firstLine.set(k, r.line);
  }
}

export async function previewImport(db: Db, actor: AuthUser, input: PreviewInput) {
  requireImports(actor);
  return (await check(db, actor, input)).preview;
}

// ---------------------------------------------------------------------------
// Commit, history and undo
// ---------------------------------------------------------------------------

const runInclude = { actor: { select: { id: true, name: true } } } as const;

function toRunView(r: Prisma.ImportRunGetPayload<{ include: typeof runInclude }>): ImportRunView {
  return {
    id: r.id,
    kind: r.kind as ImportKind,
    filename: r.filename,
    actor: r.actor,
    rowsTotal: r.rowsTotal,
    rowsCreated: r.rowsCreated,
    rowsSkipped: r.rowsSkipped,
    rowsFailed: r.rowsFailed,
    createdAt: r.createdAt.toISOString(),
    undoneAt: r.undoneAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function reasonFor(r: CheckedRow) {
  if (r.status === 'duplicate') {
    return r.duplicateOf?.kind === 'line'
      ? `Same as line ${r.duplicateOf.line} (skipped)`
      : `Already exists: ${r.duplicateOf?.kind === 'existing' ? r.duplicateOf.label : ''} (skipped)`;
  }
  return Object.values(r.errors).flat().join(' ');
}

/**
 * Creates the ready rows in one transaction. The same Idempotency-Key returns the first result,
 * and one import at a time per agency keeps two uploads from both creating the same contacts.
 */
export async function commitImport(
  db: Db,
  actor: AuthUser,
  input: CommitInput,
  key: string,
  requestId: string,
): Promise<ImportCommitResult> {
  requireImports(actor);
  const scope = `import.${input.kind}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify([input.kind, input.fileSha256, input.mapping, input.duplicates]))
    .digest('hex');
  const replay = async (tx: Db | Tx) => {
    const rec = await tx.idempotencyRecord.findUnique({
      where: { agencyId_scope_key: { agencyId: actor.agencyId, scope, key } },
    });
    if (!rec) return null;
    if (rec.requestHash !== requestHash || rec.actorId !== actor.id) {
      throw conflict('This Idempotency-Key was already used for a different import.');
    }
    const run = await tx.importRun.findUniqueOrThrow({
      where: { id: rec.resultId },
      include: runInclude,
    });
    return { run: toRunView(run), notImported: [], replayed: true };
  };
  const earlier = await replay(db);
  if (earlier) return earlier;
  if (sha256(input.csv) !== input.fileSha256) {
    throw conflict('The file changed since the preview. Preview it again before importing.');
  }

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('clientflow.import'), hashtext(${actor.agencyId}))`;
        const again = await replay(tx);
        if (again) return again;
        const { preview, rows } = await check(tx, actor, input);
        if (preview.fileErrors.length > 0) {
          throw validationFailed({ file: preview.fileErrors });
        }
        const create = rows.filter(
          (r) =>
            r.status === 'ready' || (r.status === 'duplicate' && input.duplicates === 'create'),
        );
        const skipped = rows.filter((r) => r.status === 'duplicate' && input.duplicates === 'skip');
        const failed = rows.filter((r) => r.status === 'error');
        const run = await tx.importRun.create({
          data: {
            agencyId: actor.agencyId,
            actorId: actor.id,
            kind: input.kind,
            filename: input.filename ?? null,
            fileSha256: input.fileSha256,
            rowsTotal: rows.length,
            rowsCreated: create.length,
            rowsSkipped: skipped.length,
            rowsFailed: failed.length,
          },
          include: runInclude,
        });
        const from = input.filename ? `“${input.filename}”` : 'a CSV file';
        if (input.kind === 'contacts') await insertContacts(tx, actor, run.id, create, from);
        else await insertDeals(tx, actor, run.id, create, from);
        await writeAudit(tx, {
          agencyId: actor.agencyId,
          actorId: actor.id,
          action: `import.${input.kind}`,
          outcome: 'SUCCESS',
          targetType: 'import_run',
          targetId: run.id,
          requestId,
          // Counts and the file hash only: the rows themselves are personal data (SEC-17).
          metadata: {
            fileSha256: input.fileSha256,
            created: create.length,
            skipped: skipped.length,
            failed: failed.length,
            duplicates: input.duplicates,
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            agencyId: actor.agencyId,
            actorId: actor.id,
            scope,
            key,
            requestHash,
            resultId: run.id,
          },
        });
        return {
          run: toRunView(run),
          notImported: [...skipped, ...failed]
            .sort((a, b) => a.line - b.line)
            .map((r) => ({ line: r.line, reason: reasonFor(r) })),
          replayed: false,
        };
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await replay(db);
    if (!raced) throw err;
    return raced;
  }
}

async function insertContacts(
  tx: Tx,
  actor: AuthUser,
  runId: string,
  rows: CheckedRow[],
  from: string,
) {
  if (rows.length === 0) return;
  const now = new Date();
  const created = await tx.contact.createManyAndReturn({
    data: rows.map((r) => {
      const d = r.data as Record<string, string | null>;
      return {
        agencyId: actor.agencyId,
        ownerId: d.ownerId!,
        fullName: d.fullName!,
        emailNorm: d.emailNorm ?? null,
        phone: d.phone ?? null,
        phoneNorm: d.phoneNorm ?? null,
        companyName: d.companyName ?? null,
        notes: d.notes ?? null,
        source: (d.source as ContactSource | null) ?? null,
        lifecycle: d.lifecycle as 'LEAD' | 'CUSTOMER',
        convertedAt: d.lifecycle === 'CUSTOMER' ? now : null,
        nextActionAt: d.nextActionAt ? new Date(d.nextActionAt) : null,
        importRunId: runId,
      };
    }),
    select: { id: true },
  });
  await tx.activity.createMany({
    data: created.map((c) => ({
      agencyId: actor.agencyId,
      actorId: actor.id,
      entityType: 'contact',
      entityId: c.id,
      eventType: 'contact.imported',
      summary: `Imported by ${actor.name} from ${from}`.slice(0, 500),
    })),
  });
}

async function insertDeals(
  tx: Tx,
  actor: AuthUser,
  runId: string,
  rows: CheckedRow[],
  from: string,
) {
  if (rows.length === 0) return;
  const pipeline = await getDefaultPipeline(tx, actor.agencyId);
  const created = await tx.deal.createManyAndReturn({
    data: rows.map((r) => {
      const d = r.data as Record<string, unknown>;
      return {
        agencyId: actor.agencyId,
        contactId: d.contactId as string,
        ownerId: d.ownerId as string,
        pipelineId: pipeline.id,
        stageId: d.stageId as string,
        title: d.title as string,
        amountMinor: d.amountMinor as bigint,
        currency: d.currency as string,
        expectedCloseOn: d.expectedCloseOn ? parseDateOnly(d.expectedCloseOn as string) : null,
        nextStep: (d.nextStep as string | null) ?? null,
        nextStepAt: d.nextStepAt ? new Date(d.nextStepAt as string) : null,
        importRunId: runId,
      };
    }),
    select: { id: true, contactId: true },
  });
  await tx.activity.createMany({
    data: created.flatMap((d) =>
      (['deal', 'contact'] as const).map((entityType) => ({
        agencyId: actor.agencyId,
        actorId: actor.id,
        entityType,
        entityId: entityType === 'deal' ? d.id : d.contactId,
        eventType: 'deal.imported',
        summary: `Deal imported by ${actor.name} from ${from}`.slice(0, 500),
      })),
    ),
  });
}

export async function listImports(db: Db, actor: AuthUser): Promise<ImportRunView[]> {
  requireImports(actor);
  const runs = await db.importRun.findMany({
    where: { agencyId: actor.agencyId },
    include: runInclude,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return runs.map(toRunView);
}

/**
 * Undoes an import by archiving what it created (FR-A07): reversible, and nothing is deleted.
 * Records someone changed since the import are kept as they are.
 */
export async function undoImport(
  db: Db,
  actor: AuthUser,
  id: string,
  requestId: string,
): Promise<ImportUndoResult> {
  requireImports(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  return db.$transaction(async (tx) => {
    const found = await tx.importRun.findFirst({ where: { id, agencyId: actor.agencyId } });
    if (!found) throw notFound();
    await tx.$queryRaw`SELECT id FROM import_runs WHERE id = CAST(${found.id} AS uuid) FOR UPDATE`;
    const run = await tx.importRun.findUniqueOrThrow({ where: { id: found.id } });
    if (run.undoneAt) throw conflict('This import was already undone.');
    const now = new Date();
    const where = { importRunId: run.id, archivedAt: null };
    let archived: number;
    let total: number;
    if (run.kind === 'contacts') {
      total = await tx.contact.count({ where: { importRunId: run.id } });
      // Untouched contacts only (version 1), and none that have deals.
      archived = (
        await tx.contact.updateMany({
          where: { ...where, version: 1, deals: { none: {} } },
          data: { archivedAt: now, version: { increment: 1 } },
        })
      ).count;
    } else {
      total = await tx.deal.count({ where: { importRunId: run.id } });
      archived = (
        await tx.deal.updateMany({
          where: { ...where, version: 1, status: 'OPEN', proposals: { none: {} } },
          data: { archivedAt: now, version: { increment: 1 } },
        })
      ).count;
    }
    const updated = await tx.importRun.update({
      where: { id: run.id },
      data: { undoneAt: now, undoneById: actor.id },
      include: runInclude,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'import.undo',
      outcome: 'SUCCESS',
      targetType: 'import_run',
      targetId: run.id,
      requestId,
      metadata: { archived, kept: total - archived },
    });
    return { run: toRunView(updated), archived, keptChanged: total - archived };
  });
}
