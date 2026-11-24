import { Link } from 'react-router';
import { CircleCheck, FileSignature, PackageCheck, Wallet } from 'lucide-react';
import { formatMoney, type Currency } from '@clientflow/contracts';
import { formatDate } from '../../lib/format';
import { Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { usePortalInvoices } from '../invoices/api';
import { usePortalProjects, usePortalProposals } from './api';

/**
 * The client's first screen: what waits on them, how their projects are moving and what is
 * left to pay. Built only from the portal endpoints, which are scoped to the client's
 * organization and never carry internal notes, costs, margins or staff-only tasks.
 */
export function PortalOverview() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const proposals = usePortalProposals();
  const projects = usePortalProjects();
  const invoices = usePortalInvoices();
  const loading = proposals.isPending || projects.isPending || invoices.isPending;
  if (loading) {
    return (
      <div aria-busy className="mt-6 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  const toDecide = (proposals.data?.data ?? []).filter((p) => p.displayStatus === 'SENT');
  const toReview = (projects.data?.data ?? []).filter((p) => p.awaitingReview > 0);
  const unpaid = (invoices.data?.data ?? []).filter((i) => BigInt(i.balanceMinor) > 0n);
  const balance = new Map<string, bigint>();
  for (const i of unpaid)
    balance.set(i.currency, (balance.get(i.currency) ?? 0n) + BigInt(i.balanceMinor));
  const actions = toDecide.length + toReview.reduce((n, p) => n + p.awaitingReview, 0);
  const active = (projects.data?.data ?? []).filter(
    (p) => p.state !== 'COMPLETED' && p.state !== 'ARCHIVED',
  );
  const date = (d: string) => formatDate(`${d}T12:00:00Z`, timeZone);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section
        aria-labelledby="portal-waiting"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
          <h2 id="portal-waiting" className="text-base font-semibold text-ink">
            Waiting on you
          </h2>
          {actions > 0 ? (
            <p className="text-sm text-muted">
              {actions} decision{actions === 1 ? '' : 's'} to make
            </p>
          ) : null}
        </div>
        {actions === 0 ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <CircleCheck aria-hidden className="size-4 text-primary" />
            You are up to date. New proposals and work to review will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {toDecide.map((p) => (
              <li key={p.id} className="relative flex flex-wrap items-center gap-3 px-5 py-3.5">
                <FileSignature aria-hidden className="size-5 shrink-0 text-violet" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/portal/proposals/${p.id}`}
                    className="font-medium text-ink after:absolute after:inset-0 hover:text-primary-strong"
                  >
                    Decide on proposal <span className="tabular">{p.reference}</span>
                  </Link>
                  <p className="text-[13px] text-muted">
                    {p.title}, valid until {date(p.expiresOn)}
                  </p>
                </div>
                <span className="tabular text-sm font-medium text-ink">
                  {formatMoney(p.totalMinor, p.currency)}
                </span>
              </li>
            ))}
            {toReview.map((p) => (
              <li key={p.id} className="relative flex flex-wrap items-center gap-3 px-5 py-3.5">
                <PackageCheck aria-hidden className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/portal/projects/${p.id}`}
                    className="font-medium text-ink after:absolute after:inset-0 hover:text-primary-strong"
                  >
                    Review {p.awaitingReview} deliverable{p.awaitingReview === 1 ? '' : 's'}
                  </Link>
                  <p className="text-[13px] text-muted">{p.title}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <section aria-labelledby="portal-progress" className="lg:col-span-3">
          <h2 id="portal-progress" className="text-base font-semibold text-ink">
            Work in progress
          </h2>
          {active.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No active work is shared with you yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {active.map((p) => {
                const pct = p.milestones.total
                  ? Math.round((p.milestones.done / p.milestones.total) * 100)
                  : 0;
                return (
                  <li
                    key={p.id}
                    className="relative rounded-lg border border-border bg-surface px-5 py-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        to={`/portal/projects/${p.id}`}
                        className="font-medium text-ink after:absolute after:inset-0 hover:text-primary-strong"
                      >
                        {p.title}
                      </Link>
                      <span className="text-[13px] text-muted">
                        {p.dueOn ? `Due ${date(p.dueOn)}` : 'No due date yet'}
                      </span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`${p.title}: milestones done`}
                      aria-valuemin={0}
                      aria-valuemax={p.milestones.total}
                      aria-valuenow={p.milestones.done}
                      aria-valuetext={`${p.milestones.done} of ${p.milestones.total} milestones done`}
                      className="mt-3 h-2 rounded-full bg-surface-alt"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%`, minWidth: pct > 0 ? 8 : 0 }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {p.milestones.done} of {p.milestones.total} milestones done
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="portal-balance" className="lg:col-span-2">
          <h2 id="portal-balance" className="text-base font-semibold text-ink">
            Left to pay
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-card">
            {balance.size === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Wallet aria-hidden className="size-4" /> Nothing is outstanding.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {[...balance.entries()].map(([c, v]) => (
                    <li key={c} className="figure text-2xl text-ink">
                      {formatMoney(v.toString(), c as Currency)}
                    </li>
                  ))}
                </ul>
                <ul className="mt-3 flex flex-col divide-y divide-border text-[13px]">
                  {unpaid.map((i) => (
                    <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <Link
                        to={`/portal/invoices/${i.id}`}
                        className="tabular font-medium text-primary-strong hover:underline"
                      >
                        {i.reference}
                      </Link>
                      <span
                        className={
                          i.displayStatus === 'OVERDUE' ? 'font-medium text-danger' : 'text-muted'
                        }
                      >
                        {formatMoney(i.balanceMinor, i.currency)},{' '}
                        {i.displayStatus === 'OVERDUE' ? 'was due' : 'due'} {date(i.dueOn)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  Pay as agreed with {user?.agency.name ?? 'the agency'}. This portal shows
                  balances; it does not take payments.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
