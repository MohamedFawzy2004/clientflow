import { FlaskConical } from 'lucide-react';
import type { SessionUser } from '@clientflow/contracts';
import { cn } from '../lib/format';

/** Shown on every page of a demo workspace (ADR-066), so nobody mistakes it for real data. */
export function DemoNotice({ user, className }: { user: SessionUser; className?: string }) {
  if (!user.agency.isDemo) return null;
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-md border border-info/25 bg-info-soft px-3 py-2 text-[13px] leading-5 text-text print:hidden',
        className,
      )}
    >
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
      <span>
        <span className="font-semibold">Demo workspace.</span> Every person, company and amount here
        is fictional, and the demo is reset regularly.
      </span>
    </p>
  );
}
