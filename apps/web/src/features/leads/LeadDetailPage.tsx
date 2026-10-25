import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Archive,
  ArrowLeft,
  Building,
  CalendarClock,
  ChevronRight,
  Mail,
  Phone,
  Plus,
  SearchX,
  ShieldAlert,
  StickyNote,
  UserRound,
} from 'lucide-react';
import { can, canAny, CONTACT_SOURCE_LABELS, type ContactWithDeals } from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { DealStatusBadge, Money, ReassignDialog, Timeline } from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { useAssignableOwners } from '../deals/api';
import { DealFormDialog } from '../deals/DealFormDialog';
import { useLead, useLeadAction } from './api';
import { ClientPortalCard } from './ClientPortalCard';
import { EditLeadDialog } from './EditLeadDialog';
import { NextAction } from './LeadsListPage';
import { TimelineComposer } from './TimelineComposer';

type Open = 'edit' | 'convert' | 'archive' | 'reassign' | 'deal' | null;

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    // A <dl> may only hold <div> groups of <dt>/<dd>, so the icon lives inside the <dt>.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3">
      <dt className="contents">
        <span aria-hidden className="row-span-2 mt-0.5 text-muted">
          {icon}
        </span>
        <span className="text-xs font-medium text-muted">{label}</span>
      </dt>
      <dd className="col-start-2 mt-0.5 break-words text-sm text-text">{children}</dd>
    </div>
  );
}

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        {action}
      </div>
      <div className="px-4 md:px-5">{children}</div>
    </section>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/leads"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back to leads
    </Link>
  );
}

function stale(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this lead. The page is refreshed: check it and try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : null;
}

function LeadView({ lead, timeZone }: { lead: ContactWithDeals; timeZone: string }) {
  const { data: user } = useSession();
  const action = useLeadAction(lead.id);
  const owners = useAssignableOwners();
  const [open, setOpen] = useState<Open>(null);
  if (!user) return null;

  const archived = Boolean(lead.archivedAt);
  const canWrite = can(user.role, 'contacts.write');
  const canManage = can(user.role, 'sales.reassign');
  const canDeals = canAny(user.role, ['deals.read.all', 'deals.read.own']);
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      action.reset();
    }
  };
  const run = (a: Parameters<typeof action.mutate>[0], success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setOpen(null);
      },
    });

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link to="/app/leads" className="hover:text-text">
              Leads
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate text-text">
            {lead.fullName}
          </li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden sm:block">
            <Avatar name={lead.fullName} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
                {lead.fullName}
              </h1>
              {lead.lifecycle === 'CUSTOMER' ? (
                <Badge tone="success">Customer</Badge>
              ) : (
                <Badge tone="info">Lead</Badge>
              )}
              {archived ? (
                <Badge tone="neutral" icon={<Archive aria-hidden className="size-3.5" />}>
                  Archived
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {lead.companyName ? `${lead.companyName} · ` : ''}Owned by {lead.owner.name}
            </p>
          </div>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {archived ? (
              <Button
                variant="secondary"
                loading={action.isPending}
                loadingLabel="Restoring…"
                onClick={() => run({ kind: 'restore', version: lead.version }, 'Lead restored')}
              >
                Restore
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen('edit')}>
                  Edit
                </Button>
                {lead.lifecycle === 'LEAD' ? (
                  <Button variant="secondary" onClick={() => setOpen('convert')}>
                    Convert to customer
                  </Button>
                ) : null}
                {canManage ? (
                  <Button variant="secondary" onClick={() => setOpen('reassign')}>
                    Reassign
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setOpen('archive')}>
                  Archive
                </Button>
              </>
            )}
          </div>
        ) : null}
      </header>

      {archived ? (
        <Banner tone="info" title="This lead is archived" className="mt-5">
          It is hidden from lists and follow-ups and cannot be changed. Restore it to work on it
          again.
        </Banner>
      ) : null}
      {action.error && open === null ? (
        <Banner tone="danger" title="That did not work" className="mt-5">
          {stale(action.error)}
        </Banner>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <Card title="Next step">
            <div className="py-3 text-sm">
              <NextAction iso={lead.nextActionAt} timeZone={timeZone} />
            </div>
          </Card>
          {canDeals ? (
            <Card
              title="Deals"
              action={
                canWrite && !archived ? (
                  <Button size="sm" variant="secondary" onClick={() => setOpen('deal')}>
                    <Plus aria-hidden className="size-4" /> New deal
                  </Button>
                ) : undefined
              }
            >
              {lead.deals.length === 0 ? (
                <p className="py-4 text-sm text-muted">No deals yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {lead.deals.map((d) => (
                    <li key={d.id}>
                      <Link
                        to={`/app/deals/${d.id}`}
                        className="flex items-center justify-between gap-3 py-3 hover:text-primary-strong"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-text">
                            {d.title}
                          </span>
                          <span className="block text-xs text-muted">
                            {d.status === 'OPEN' ? (
                              d.stage.name
                            ) : (
                              <DealStatusBadge status={d.status} />
                            )}
                          </span>
                        </span>
                        <Money
                          minor={d.amountMinor}
                          currency={d.currency}
                          className="text-sm font-semibold text-text"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
          <Card title="Contact details">
            <dl className="divide-y divide-border">
              <DetailRow icon={<Mail className="size-4" />} label="Email">
                {lead.email ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline"
                    href={`mailto:${lead.email}`}
                  >
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Phone className="size-4" />} label="Phone">
                {lead.phone ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline tabular"
                    href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
                  >
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Building className="size-4" />} label="Company">
                {lead.companyName ?? <span className="text-muted">Not provided</span>}
              </DetailRow>
              <DetailRow icon={<UserRound className="size-4" />} label="Source">
                {lead.source ? (
                  CONTACT_SOURCE_LABELS[lead.source]
                ) : (
                  <span className="text-muted">Not specified</span>
                )}
              </DetailRow>
              <DetailRow icon={<CalendarClock className="size-4" />} label="Added">
                <span className="tabular">{formatDateTime(lead.createdAt, timeZone)}</span>
              </DetailRow>
              {lead.convertedAt ? (
                <DetailRow icon={<CalendarClock className="size-4" />} label="Became a customer">
                  <span className="tabular">{formatDateTime(lead.convertedAt, timeZone)}</span>
                </DetailRow>
              ) : null}
            </dl>
          </Card>
          <Card title="Notes">
            {lead.notes ? (
              // Rendered as text, never as HTML, so stored markup cannot run (T-SEC-03).
              <p className="whitespace-pre-wrap break-words py-3 text-sm leading-[22px] text-text">
                {lead.notes}
              </p>
            ) : (
              <p className="flex items-center gap-2 py-4 text-sm text-muted">
                <StickyNote aria-hidden className="size-4" />
                No notes yet.
              </p>
            )}
          </Card>
          <ClientPortalCard lead={lead} />
        </div>

        <Card title="Activity">
          {canWrite ? (
            <div className="border-b border-border">
              <TimelineComposer
                leadId={lead.id}
                timeZone={timeZone}
                disabled={archived ? 'Restore this lead to log activity.' : undefined}
              />
            </div>
          ) : null}
          <Timeline entries={lead.activities} timeZone={timeZone} />
        </Card>
      </div>

      {open === 'edit' ? (
        <EditLeadDialog
          lead={lead}
          timeZone={timeZone}
          open
          onOpenChange={(o) => !o && setOpen(null)}
        />
      ) : null}
      {open === 'deal' ? (
        <DealFormDialog open onOpenChange={(o) => !o && setOpen(null)} contact={lead} />
      ) : null}
      <ConfirmDialog
        open={open === 'convert'}
        onOpenChange={close}
        title={`Convert ${lead.fullName} to a customer?`}
        description="The record keeps its history and deals. Winning a deal does this automatically."
        confirmLabel="Convert"
        pendingLabel="Converting…"
        tone="primary"
        pending={action.isPending}
        error={open === 'convert' ? stale(action.error) : null}
        onConfirm={() => run({ kind: 'convert', version: lead.version }, 'Now a customer')}
      />
      <ConfirmDialog
        open={open === 'archive'}
        onOpenChange={close}
        title={`Archive ${lead.fullName}?`}
        description="Archived leads leave lists and follow-ups. Nothing is deleted, and you can restore it any time."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        pending={action.isPending}
        error={open === 'archive' ? stale(action.error) : null}
        onConfirm={() => run({ kind: 'archive', version: lead.version }, 'Lead archived')}
      />
      {open === 'reassign' ? (
        <ReassignDialog
          open
          onOpenChange={close}
          what="lead"
          currentOwnerId={lead.owner.id}
          owners={owners.data?.data ?? [lead.owner]}
          pending={action.isPending}
          error={stale(action.error)}
          onConfirm={(ownerId) =>
            run({ kind: 'reassign', ownerId, version: lead.version }, 'Lead reassigned')
          }
        />
      ) : null}
    </>
  );
}

export function LeadDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useLead(id);
  const error = query.error instanceof ApiError ? query.error : null;

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }
  if (error?.status === 404) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Lead not found"
          description="This lead does not exist, was archived, or is not assigned to you."
        />
      </>
    );
  }
  if (error?.status === 403) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="You do not have access to leads"
          description="Ask your agency owner or admin if you need access."
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <BackLink />
        <ErrorState
          message={query.error.message}
          requestId={error?.requestId}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </>
    );
  }
  return <LeadView lead={query.data.data} timeZone={timeZone} />;
}
