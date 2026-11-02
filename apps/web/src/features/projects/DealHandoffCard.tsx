import { useState } from 'react';
import { Link } from 'react-router';
import type { DealDetail } from '@clientflow/contracts';
import { Button } from '../../components/ui/button';
import { useProjectPermissions } from './api';
import { ConvertDealDialog } from './ConvertDealDialog';

/** On a won deal: the project it became, or the way to hand it off (spec J3). */
export function DealHandoffCard({ deal }: { deal: DealDetail }) {
  const perms = useProjectPermissions();
  const [open, setOpen] = useState(false);
  if (deal.status !== 'WON') return null;

  let body;
  if (deal.project) {
    body = (
      <p className="text-sm text-text">
        Handed off to{' '}
        {perms.read ? (
          <Link
            to={`/app/projects/${deal.project.id}`}
            className="font-medium text-primary-strong hover:underline"
          >
            {deal.project.title}
          </Link>
        ) : (
          <span className="font-medium">{deal.project.title}</span>
        )}
        .
      </p>
    );
  } else if (!deal.acceptedProposal) {
    body = (
      <p className="text-sm text-muted">
        Won without a client-accepted proposal, so there is no agreed scope to hand off. A PM or
        admin can create the project manually.
      </p>
    );
  } else if (perms.create) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted">
          The client accepted the proposal. Start delivery with its scope as the baseline.
        </p>
        <Button onClick={() => setOpen(true)}>Convert to project</Button>
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-muted">Waiting for a project manager to start the project.</p>
    );
  }

  return (
    <section
      aria-label="Delivery"
      className="rounded-lg border border-border bg-surface p-4 shadow-card md:p-5"
    >
      <h2 className="mb-3 text-[15px] font-semibold text-text">Delivery</h2>
      {body}
      {open ? (
        <ConvertDealDialog dealId={deal.id} dealTitle={deal.title} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}
