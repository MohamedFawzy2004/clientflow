import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Download, FileSpreadsheet, History, ShieldAlert, Undo2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportCommitResult,
  type ImportKind,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRunView,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Select } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import {
  useCanImport,
  useCommitImport,
  useImportRuns,
  usePreviewImport,
  useUndoImport,
} from './api';

/** "1 contact", "3 contacts". */
const count = (n: number, kind: ImportKind) =>
  `${n} ${n === 1 ? KIND_LABELS[kind].one : KIND_LABELS[kind].many}`;

const KIND_LABELS: Record<ImportKind, { one: string; many: string; list: string }> = {
  contacts: { one: 'contact', many: 'contacts', list: '/app/leads' },
  deals: { one: 'deal', many: 'deals', list: '/app/deals' },
};

/** Rows shown in the preview list; the counts always cover the whole file. */
const SHOWN_ROWS = 200;

function message(err: unknown) {
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** A header row with every field, as a starting point for people building a file by hand. */
function templateHref(kind: ImportKind) {
  const header = IMPORT_FIELDS[kind].map((f) => f.label).join(',');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${header}\n`)}`;
}

function StatusBadge({ row }: { row: ImportPreviewRow }) {
  if (row.status === 'ready') return <Badge tone="success">Ready</Badge>;
  if (row.status === 'duplicate') return <Badge tone="warning">Duplicate</Badge>;
  return <Badge tone="danger">Needs fixing</Badge>;
}

function rowProblem(row: ImportPreviewRow) {
  if (row.duplicateOf?.kind === 'existing') return `Matches “${row.duplicateOf.label}”.`;
  if (row.duplicateOf?.kind === 'line') return `Same as line ${row.duplicateOf.line}.`;
  return Object.values(row.errors).flat().join(' ');
}

function Rows({ preview }: { preview: ImportPreview }) {
  const [filter, setFilter] = useState<'all' | 'problems'>('problems');
  const main = IMPORT_FIELDS[preview.kind].slice(0, 2).map((f) => f.key);
  const rows = preview.rows.filter((r) => filter === 'all' || r.status !== 'ready');
  return (
    <Card
      title="Rows"
      action={
        <div className="flex gap-1" role="group" aria-label="Show rows">
          {(['problems', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-8 rounded-sm px-3 text-[13px] font-medium',
                filter === f
                  ? 'bg-primary-soft text-primary-strong'
                  : 'text-muted hover:bg-surface-alt hover:text-text',
              )}
            >
              {f === 'problems' ? 'Problems' : 'All rows'}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Every row is ready to import.</p>
      ) : (
        <ul className="-mx-4 md:-mx-5">
          {rows.slice(0, SHOWN_ROWS).map((r) => (
            <li
              key={r.line}
              className="flex flex-col gap-1 border-b border-border px-4 py-2.5 last:border-0 sm:flex-row sm:items-start sm:gap-3 md:px-5"
            >
              <span className="flex shrink-0 items-center gap-2 sm:w-40">
                <span className="tabular w-14 text-xs text-muted">Line {r.line}</span>
                <StatusBadge row={r} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm text-text">
                  {main
                    .map((k) => r.values[k])
                    .filter(Boolean)
                    .join(' · ') || '(empty)'}
                </span>
                {r.status !== 'ready' ? (
                  <span
                    className={cn(
                      'block break-words text-[13px]',
                      r.status === 'error' ? 'text-danger' : 'text-warning',
                    )}
                  >
                    {rowProblem(r)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > SHOWN_ROWS ? (
        <p className="mt-3 text-xs text-muted">
          Showing the first {SHOWN_ROWS} of {rows.length}. Fix them in the file and choose it again.
        </p>
      ) : null}
    </Card>
  );
}

function Result({ result, onUndo }: { result: ImportCommitResult; onUndo: () => void }) {
  const k = KIND_LABELS[result.run.kind];
  return (
    <Card title="Import finished">
      <Banner tone="success" title={`${count(result.run.rowsCreated, result.run.kind)} imported`}>
        {result.run.rowsSkipped} skipped as duplicates, {result.run.rowsFailed} not imported because
        of errors.
      </Banner>
      {result.notImported.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-text">
            Lines not imported ({result.notImported.length})
          </summary>
          <ul className="mt-2 grid gap-1 text-[13px] text-muted">
            {result.notImported.slice(0, SHOWN_ROWS).map((n) => (
              <li key={n.line} className="break-words">
                <span className="tabular font-medium text-text">Line {n.line}:</span> {n.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          to={k.list}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Open {k.many}
        </Link>
        {result.run.rowsCreated > 0 ? (
          <Button variant="secondary" onClick={onUndo}>
            <Undo2 aria-hidden className="size-4" /> Undo this import
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function RunHistory({ onUndo }: { onUndo: (run: ImportRunView) => void }) {
  const { data: user } = useSession();
  const runs = useImportRuns();
  const tz = user?.agency.timezone;
  if (runs.isPending) return <Skeleton className="h-32 rounded-lg" />;
  if (runs.isError) {
    return (
      <ErrorState
        message={message(runs.error)}
        onRetry={() => runs.refetch()}
        retrying={runs.isFetching}
      />
    );
  }
  const list = runs.data.data;
  return (
    <Card title="Past imports">
      {list.length === 0 ? (
        <p className="text-sm text-muted">No imports yet.</p>
      ) : (
        <ul className="-mx-4 md:-mx-5">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between md:px-5"
            >
              <span className="min-w-0">
                <span className="block break-words text-sm font-medium text-text">
                  {r.filename ?? 'CSV file'} · {count(r.rowsCreated, r.kind)}
                </span>
                <span className="block text-[13px] text-muted">
                  {r.actor.name} · {formatDateTime(r.createdAt, tz)}
                  {r.undoneAt ? ` · undone ${formatDateTime(r.undoneAt, tz)}` : ''}
                </span>
              </span>
              {r.undoneAt ? (
                <Badge>Undone</Badge>
              ) : r.rowsCreated > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUndo(r)}
                  aria-label={`Undo import of ${r.filename ?? 'CSV file'} from ${formatDateTime(r.createdAt, tz)}`}
                >
                  <Undo2 aria-hidden className="size-4" /> Undo
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** CSV import of contacts or deals (FR-C10): preview, map, check, import, and undo. */
export function ImportPage() {
  const allowed = useCanImport();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>('contacts');
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [duplicates, setDuplicates] = useState<'skip' | 'create'>('skip');
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [undoing, setUndoing] = useState<ImportRunView | null>(null);
  /** One Idempotency-Key per (file, mapping, option): a retry never imports twice. */
  const keys = useRef(new Map<string, string>());
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const undo = useUndoImport();

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Imports are for owners, admins and sales managers"
      />
    );
  }

  const p = preview.data?.data ?? null;
  const toImport = p ? p.counts.ready + (duplicates === 'create' ? p.counts.duplicate : 0) : 0;

  const run = (next: {
    kind?: ImportKind;
    csv?: string;
    name?: string;
    mapping?: ImportPreview['mapping'];
  }) => {
    const csv = next.csv ?? file?.csv;
    if (!csv) return;
    setResult(null);
    preview.mutate({
      kind: next.kind ?? kind,
      filename: next.name ?? file?.name,
      csv,
      ...(next.mapping ? { mapping: next.mapping } : {}),
    });
  };

  const pick = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    // Quick feedback only; the API enforces the same limit.
    if (f.size > IMPORT_MAX_BYTES) {
      toast.error(`“${f.name}” is larger than 1 MB. Split it into smaller files.`);
      return;
    }
    const csv = await f.text();
    setFile({ name: f.name, csv });
    run({ csv, name: f.name });
  };

  const submit = () => {
    if (!p || !file) return;
    const id = `${p.fileSha256}|${JSON.stringify(p.mapping)}|${duplicates}`;
    if (!keys.current.has(id)) keys.current.set(id, crypto.randomUUID());
    commit
      .mutateAsync({
        key: keys.current.get(id)!,
        body: {
          kind: p.kind,
          filename: file.name,
          csv: file.csv,
          mapping: p.mapping,
          duplicates,
          fileSha256: p.fileSha256,
        },
      })
      .then((res) => {
        setResult(res.data);
        preview.reset();
        setFile(null);
        toast.success(`${count(res.data.run.rowsCreated, res.data.run.kind)} imported`);
      })
      .catch(() => undefined);
  };

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Import from CSV
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Bring contacts or deals from a spreadsheet. You see every row before anything is saved,
        duplicates are flagged, and an import can be undone. The file itself is not kept.
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card title="1. Choose a file">
            <div className="grid gap-5">
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-text">
                  What are you importing?
                </legend>
                <div className="flex flex-wrap gap-2" role="group">
                  {(['contacts', 'deals'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => {
                        setKind(k);
                        run({ kind: k });
                      }}
                      className={cn(
                        'h-10 rounded-md border px-4 text-sm font-medium capitalize',
                        kind === k
                          ? 'border-primary bg-primary-soft text-primary-strong'
                          : 'border-border-strong bg-surface text-text hover:bg-surface-alt',
                      )}
                    >
                      {KIND_LABELS[k].many}
                    </button>
                  ))}
                </div>
                {kind === 'deals' ? (
                  <p className="mt-2 text-[13px] text-muted">
                    Each deal needs the email of a contact that is already in ClientFlow. Import
                    contacts first.
                  </p>
                ) : null}
              </fieldset>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={input}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => void pick(e.target.files?.[0])}
                />
                <Button
                  onClick={() => input.current?.click()}
                  loading={preview.isPending}
                  loadingLabel="Checking the file…"
                >
                  <Upload aria-hidden className="size-4" /> Choose CSV file
                </Button>
                <a
                  href={templateHref(kind)}
                  download={`clientflow-${kind}-template.csv`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Download aria-hidden className="size-4" /> Download a template
                </a>
              </div>
              {file ? (
                <p className="flex items-center gap-2 break-all text-sm text-text">
                  <FileSpreadsheet aria-hidden className="size-4 shrink-0 text-muted" />
                  {file.name}
                </p>
              ) : (
                <p className="text-[13px] text-muted">
                  UTF-8 CSV with a header row, up to 1 MB and {IMPORT_MAX_ROWS.toLocaleString('en')}{' '}
                  rows. In Excel: Save As → “CSV UTF-8”.
                </p>
              )}
              {preview.error ? (
                <Banner tone="danger" title="The file could not be checked">
                  {message(preview.error)}
                </Banner>
              ) : null}
            </div>
          </Card>

          {p ? (
            <>
              {p.fileErrors.length > 0 ? (
                <Banner tone="danger" title="Fix the file before importing">
                  <ul className="list-disc pl-4">
                    {p.fileErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Banner>
              ) : null}

              {p.headers.length > 0 ? (
                <Card title="2. Match the columns">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {IMPORT_FIELDS[p.kind].map((f) => (
                      <Field key={f.key} label={f.label} required={f.required}>
                        {(control) => (
                          <Select
                            {...control}
                            value={p.mapping[f.key] ?? ''}
                            onChange={(e) =>
                              run({ mapping: { ...p.mapping, [f.key]: e.target.value || null } })
                            }
                          >
                            <option value="">Do not import</option>
                            {p.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    ))}
                  </div>
                </Card>
              ) : null}

              {p.fileErrors.length === 0 ? <Rows preview={p} /> : null}
            </>
          ) : null}

          {result ? <Result result={result} onUndo={() => setUndoing({ ...result.run })} /> : null}
        </div>

        <div className="grid min-w-0 content-start gap-6">
          {p && p.fileErrors.length === 0 ? (
            <Card title="3. Import">
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Ready', value: p.counts.ready, tone: 'text-success' },
                  { label: 'Duplicates', value: p.counts.duplicate, tone: 'text-warning' },
                  { label: 'Errors', value: p.counts.error, tone: 'text-danger' },
                ].map((c) => (
                  <div key={c.label} className="rounded-md bg-surface-alt px-2 py-2">
                    <dt className="text-xs text-muted">{c.label}</dt>
                    <dd className={cn('tabular text-lg font-semibold', c.value > 0 && c.tone)}>
                      {c.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {p.counts.duplicate > 0 ? (
                <fieldset className="mt-4 grid gap-1">
                  <legend className="mb-1 text-sm font-medium text-text">Duplicates</legend>
                  {(
                    [
                      ['skip', 'Skip them (recommended)'],
                      ['create', 'Import them anyway'],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex min-h-11 items-center gap-2 text-sm text-text"
                    >
                      <input
                        type="radio"
                        name="duplicates"
                        value={value}
                        checked={duplicates === value}
                        onChange={() => setDuplicates(value)}
                        className="size-4 accent-[var(--color-primary)]"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <p className="mt-3 text-[13px] text-muted">
                Rows with errors are left out. Nothing is merged into existing records.
              </p>
              {commit.error ? (
                <Banner tone="danger" title="Not imported" className="mt-3">
                  {message(commit.error)}
                </Banner>
              ) : null}
              <Button
                className="mt-4 w-full"
                onClick={submit}
                disabled={toImport === 0 || preview.isPending}
                loading={commit.isPending}
                loadingLabel="Importing…"
              >
                Import {count(toImport, kind)}
              </Button>
            </Card>
          ) : null}
          <section aria-label="History" className="grid gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
              <History aria-hidden className="size-4" /> History
            </h2>
            <RunHistory onUndo={setUndoing} />
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setUndoing(null);
            undo.reset();
          }
        }}
        title="Undo this import?"
        description={`The ${undoing ? KIND_LABELS[undoing.kind].many : 'records'} it created are archived, so they leave your lists but are not deleted. Records someone changed since the import stay as they are.`}
        confirmLabel="Undo import"
        pendingLabel="Undoing…"
        pending={undo.isPending}
        error={undo.error ? message(undo.error) : null}
        onConfirm={() =>
          undoing &&
          undo
            .mutateAsync(undoing.id)
            .then((res) => {
              toast.success(
                `${res.data.archived} archived${res.data.keptChanged ? `, ${res.data.keptChanged} kept because they changed` : ''}`,
              );
              setUndoing(null);
              setResult(null);
            })
            .catch(() => undefined)
        }
      />
    </>
  );
}
