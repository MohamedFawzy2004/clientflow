import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Clock, FileClock, MessageSquareWarning, Send } from 'lucide-react';
import {
  formatBp,
  formatMoney,
  PROPOSAL_STATUS_LABELS,
  type Currency,
  type ProposalDisplayStatus,
  type ProposalVersionContent,
} from '@clientflow/contracts';
import { cn, formatDate } from '../../lib/format';
import { Badge } from '../ui/feedback';
import { Money } from '../sales/sales-ui';

const STATUS_TONE: Record<
  ProposalDisplayStatus,
  'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  APPROVED_INTERNAL: 'primary',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning',
  SUPERSEDED: 'neutral',
  EXPIRED: 'neutral',
};

const STATUS_ICON: Partial<Record<ProposalDisplayStatus, typeof Clock>> = {
  IN_REVIEW: Clock,
  SENT: Send,
  ACCEPTED: CircleCheck,
  REJECTED: CircleX,
  CHANGES_REQUESTED: MessageSquareWarning,
  EXPIRED: FileClock,
};

/** Download links styled like secondary buttons (a real link, so the browser saves the file). */
export const PDF_LINK =
  'inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text shadow-[0_1px_2px_rgba(16,36,60,0.06)] hover:bg-surface-alt';

export function ProposalStatusBadge({ status }: { status: ProposalDisplayStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge
      tone={STATUS_TONE[status]}
      icon={Icon ? <Icon aria-hidden className="size-3.5" /> : undefined}
    >
      {PROPOSAL_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Multi-line plain text (stored text is rendered as text, never HTML). */
function Prose({ text }: { text: string }) {
  return <p className="whitespace-pre-line break-words text-sm leading-6 text-text">{text}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Totals with every step explained (FR-Q03): what was discounted, what was taxed, and how. */
export function TotalsBreakdown({
  currency,
  subtotalMinor,
  discountMinor,
  discountBp,
  taxMinor,
  taxRateBp,
  taxLabel,
  totalMinor,
  preview,
}: {
  currency: Currency;
  subtotalMinor: string;
  discountMinor: string;
  discountBp: number;
  taxMinor: string;
  taxRateBp: number;
  taxLabel: string;
  totalMinor: string;
  preview?: boolean;
}) {
  const taxable = (BigInt(subtotalMinor) - BigInt(discountMinor)).toString();
  return (
    <div className="break-inside-avoid">
      <dl className="ml-auto flex w-full max-w-sm flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Subtotal</dt>
          <dd>
            <Money minor={subtotalMinor} currency={currency} />
          </dd>
        </div>
        {discountBp > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Discount {formatBp(discountBp)}%</dt>
            <dd>
              −<Money minor={discountMinor} currency={currency} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">
            {taxLabel} {formatBp(taxRateBp)}% of {formatMoney(taxable, currency)}
          </dt>
          <dd>
            <Money minor={taxMinor} currency={currency} />
          </dd>
        </div>
        <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2.5 text-base font-semibold">
          <dt>Total</dt>
          <dd>
            <Money minor={totalMinor} currency={currency} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-right text-xs leading-5 text-muted">
        Prices exclude {taxLabel}. Each amount is rounded to the nearest{' '}
        {currency === 'EGP' ? 'piastre' : 'cent'} (half up).
        {preview ? ' Preview: the server recalculates on save.' : ''}
      </p>
    </div>
  );
}

/** The client-visible content of a version. Internal notes are never part of this component. */
export function ProposalDocument({
  content,
  reference,
  timeZone,
  header,
}: {
  content: ProposalVersionContent;
  reference: string;
  timeZone: string;
  header?: ReactNode;
}) {
  const c = content;
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-[13px] text-muted">
          <span className="tabular">{reference}</span> · Version {c.versionNo} · Valid until{' '}
          {formatDate(`${c.expiresOn}T12:00:00Z`, timeZone)}
        </p>
        <h2 className="break-words text-xl font-semibold leading-7 text-text">{c.title}</h2>
        {header}
      </header>
      {c.summary ? <Prose text={c.summary} /> : null}
      <div className="grid gap-6 md:grid-cols-2">
        {c.inclusions ? (
          <Section title="Included">
            <Prose text={c.inclusions} />
          </Section>
        ) : null}
        {c.exclusions ? (
          <Section title="Not included">
            <Prose text={c.exclusions} />
          </Section>
        ) : null}
        {c.assumptions ? (
          <Section title="Assumptions">
            <Prose text={c.assumptions} />
          </Section>
        ) : null}
        {c.milestones ? (
          <Section title="Milestones">
            <Prose text={c.milestones} />
          </Section>
        ) : null}
      </div>

      <Section title="Price">
        {/* Phones: one block per line item, so nothing scrolls sideways at 360px. */}
        <ul className="divide-y divide-border rounded-md border border-border sm:hidden">
          {c.items.map((i) => (
            <li key={i.id} className="px-3 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words font-medium text-text">{i.name}</p>
                <Money minor={i.lineTotalMinor} currency={c.currency} className="font-medium" />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                <span className="tabular">
                  {i.quantity} {i.unit}
                </span>{' '}
                × {formatMoney(i.unitPriceMinor, c.currency)}
              </p>
              {i.description ? (
                <p className="mt-1 whitespace-pre-line text-xs text-muted">{i.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="hidden rounded-md border border-border sm:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Line items</caption>
            <thead className="bg-surface-alt text-left text-xs font-semibold text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2.5 align-top">
                    <p className="font-medium text-text">{i.name}</p>
                    {i.description ? (
                      <p className="mt-0.5 whitespace-pre-line text-xs text-muted">
                        {i.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-right align-top">
                    {i.quantity} {i.unit}
                  </td>
                  <td className="px-3 py-2.5 text-right align-top">
                    <Money minor={i.unitPriceMinor} currency={c.currency} />
                  </td>
                  <td className="px-3 py-2.5 text-right align-top font-medium">
                    <Money minor={i.lineTotalMinor} currency={c.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <TotalsBreakdown {...c} />
        </div>
      </Section>

      {c.paymentTerms ? (
        <Section title="Payment terms">
          <Prose text={c.paymentTerms} />
        </Section>
      ) : null}
      {c.terms ? (
        <Section title="Terms">
          <Prose text={c.terms} />
        </Section>
      ) : null}
    </article>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn('rounded-lg border border-border bg-surface shadow-card', className)}
    >
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="px-4 py-4 md:px-5">{children}</div>
    </section>
  );
}
