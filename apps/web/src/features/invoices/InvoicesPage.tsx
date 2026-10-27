import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Receipt, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, INVOICE_STATUS_LABELS, INVOICE_STATUSES } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { InvoiceStatusBadge, NOT_ACCOUNTING_NOTICE } from '../../components/finance/finance-ui';
import { useSession } from '../auth/session';
import { useInvoiceAction, useInvoiceOptions, useInvoices } from './api';

export function invoiceMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this invoice. It is refreshed: try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function NewInvoiceDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const options = useInvoiceOptions(true);
  const action = useInvoiceAction();
  const [orgId, setOrgId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [touched, setTouched] = useState(false);
  /** One Idempotency-Key per set of values: a retry or double click reuses it. */
  const keys = useRef(new Map<string, string>());
  const orgs = options.data?.data ?? [];
  const projects = orgs.find((o) => o.id === orgId)?.projects ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!orgId || !dueOn) return;
    const values = `${orgId}|${projectId}|${dueOn}`;
    if (!keys.current.has(values)) keys.current.set(values, crypto.randomUUID());
    action.mutate(
      {
        kind: 'create',
        key: keys.current.get(values)!,
        body: { clientOrgId: orgId, projectId: projectId || null, dueOn },
      },
      {
        onSuccess: (res) => {
          toast.success('Draft invoice created');
          onClose();
          navigate(`/app/invoices/${(res as { data: { id: string } }).data.id}`);
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title="New invoice"
      description="Start a draft. Nothing is sent or numbered until you issue it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-invoice"
            loading={action.isPending}
            loadingLabel="Creating…"
          >
            Create draft
          </Button>
        </>
      }
    >
      {action.error ? (
        <Banner tone="danger" title="Not created" className="mb-5">
          {invoiceMessage(action.error)}
        </Banner>
      ) : null}
      <form id="new-invoice" onSubmit={submit} noValidate className="grid gap-5">
        <Field
          label="Client"
          required
          error={touched && !orgId ? 'Choose who is billed.' : undefined}
        >
          {(fp) => (
            <Select
              {...fp}
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setProjectId('');
              }}
            >
              <option value="">Choose…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Project"
          hint="Bill a project's milestones and accepted changes, in its currency."
        >
          {(fp) => (
            <Select
              {...fp}
              value={projectId}
              disabled={!orgId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.currency})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due" required error={touched && !dueOn ? 'Choose the due date.' : undefined}>
          {(fp) => (
            <Input {...fp} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Invoices the viewer may see: all for finance, the projects they lead for PMs (spec §1.1). */
export function InvoicesPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useInvoices(status ? { status } : {});
  const error = q.error instanceof ApiError ? q.error : null;
  if (error?.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Invoices are not part of your role"
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-muted">{NOT_ACCOUNTING_NOTICE}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="invoice-status" className="text-[13px] font-medium text-text">
              Status
            </label>
            <Select
              id="invoice-status"
              className="mt-1.5 w-auto min-w-[160px]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              {[...INVOICE_STATUSES, 'OVERDUE' as const].map((s) => (
                <option key={s} value={s}>
                  {INVOICE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {q.data?.data.access.create ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New invoice
            </Button>
          ) : null}
        </div>
      </div>
      <section
        aria-label="Invoice list"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {q.isPending ? (
          <div aria-busy className="flex flex-col gap-3 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : q.isError ? (
          <ErrorState
            message={invoiceMessage(q.error)}
            requestId={error?.requestId}
            onRetry={() => q.refetch()}
            retrying={q.isFetching}
          />
        ) : q.data.data.invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt aria-hidden className="size-5" />}
            title={status ? 'No invoices with this status' : 'No invoices yet'}
            description="Bill milestones and accepted changes from a draft, then record payments as they arrive."
          />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.data.invoices.map((i) => (
              <li key={i.id} className="relative px-4 py-3.5 hover:bg-surface-alt/50 md:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/app/invoices/${i.id}`}
                      className="block break-words font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                    >
                      <span className="tabular">{i.reference}</span> · {i.clientOrg.name}
                    </Link>
                    <p className="text-[13px] text-muted">
                      {i.project ? `${i.project.title} · ` : ''}
                      {i.issuedOn ? `issued ${formatDay(i.issuedOn, timeZone)} · ` : ''}due{' '}
                      {formatDay(i.dueOn, timeZone)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <InvoiceStatusBadge status={i.displayStatus} />
                    <span className="text-right text-sm">
                      <span className="block font-medium tabular-nums text-text">
                        {formatMoney(i.totalMinor, i.currency)}
                      </span>
                      {i.status !== 'DRAFT' && i.status !== 'VOID' && i.balanceMinor !== '0' ? (
                        <span className="block text-xs tabular-nums text-muted">
                          {formatMoney(i.balanceMinor, i.currency)} open
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {creating ? <NewInvoiceDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
