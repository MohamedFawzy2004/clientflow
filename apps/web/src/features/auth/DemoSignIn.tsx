import { FlaskConical } from 'lucide-react';
import { ROLES, ROLE_LABELS, type DemoAccount, type Role } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/ui/feedback';
import { useDemoSignIn } from './session';

/** What each role shows a visitor, in a few words. */
const ROLE_HINTS: Record<Role, string> = {
  OWNER: 'Everything, including team and finance',
  ADMIN: 'Runs the workspace day to day',
  SALES_MANAGER: 'The whole pipeline and forecasts',
  SALES: 'Their own leads and deals',
  PM: 'Projects, tasks and approvals',
  MEMBER: 'Assigned tasks and time',
  FINANCE: 'Invoices, payments and reports',
  CLIENT: 'The client portal',
};

// The placeholders show the same role labels (they may wrap the same way), and the name is one
// line, so a button is the same height before and after the names arrive.
const LABEL = 'text-sm font-medium leading-5 text-text';
const NAME = 'block h-4 w-full truncate text-xs font-normal leading-4 text-muted';
const BUTTON =
  'h-auto min-h-11 w-full flex-col items-start justify-center gap-0 whitespace-normal px-3 py-2 text-left';

/**
 * The public demo's sign-in (ADR-071): pick a role, no password. Shown only when the server is a
 * demo deployment and has demo people to offer. While `accounts` is still loading (undefined),
 * the block keeps its full size with one placeholder per role, so nothing below it moves.
 */
export function DemoSignIn({
  accounts,
  onSignedIn,
}: {
  accounts: DemoAccount[] | undefined;
  onSignedIn: (role: Role) => void;
}) {
  const signIn = useDemoSignIn();
  const pending = signIn.isPending ? signIn.variables?.role : undefined;
  const failure =
    signIn.error instanceof ApiError && signIn.error.code === 'RATE_LIMITED'
      ? 'Too many demo sign-ins from your address. Please wait a few minutes.'
      : signIn.isError
        ? 'The demo could not sign you in. Please try again.'
        : null;

  return (
    <section aria-labelledby="demo-title" className="mt-6">
      <div className="rounded-lg border border-info/25 bg-info-soft p-4">
        <h2
          id="demo-title"
          className="flex items-center gap-2 text-[15px] font-semibold leading-6 text-text"
        >
          <FlaskConical aria-hidden className="size-4 text-info" /> Explore the demo
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          Everything here is fictional. No emails are sent, there are no payments, and the demo is
          reset regularly, so your changes do not last. The first visit can take up to a minute
          while the server wakes up.
        </p>
        {failure ? (
          <Banner tone="danger" title="Not signed in" className="mt-3">
            {failure}
          </Banner>
        ) : null}
        <p className="mt-3 text-[13px] font-medium text-text">Explore as:</p>
        {accounts ? (
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {accounts.map((a) => (
              <li key={a.role}>
                <Button
                  variant="secondary"
                  className={BUTTON}
                  aria-label={`Explore as ${ROLE_LABELS[a.role]} (${a.name}): ${ROLE_HINTS[a.role]}`}
                  title={ROLE_HINTS[a.role]}
                  loading={pending === a.role}
                  loadingLabel="Signing in…"
                  disabled={signIn.isPending && pending !== a.role}
                  onClick={() =>
                    signIn.mutate({ role: a.role }, { onSuccess: (d) => onSignedIn(d.user.role) })
                  }
                >
                  <span className={LABEL}>{ROLE_LABELS[a.role]}</span>
                  <span className={NAME}>{a.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p role="status" className="sr-only">
              Loading the demo accounts…
            </p>
            <ul aria-hidden className="mt-2 grid grid-cols-2 gap-2">
              {ROLES.map((role) => (
                <li key={role}>
                  <Button variant="secondary" className={BUTTON} disabled tabIndex={-1}>
                    <span className={LABEL}>{ROLE_LABELS[role]}</span>
                    {/* A span, not <Skeleton>: a button may only hold phrasing content. */}
                    <span className={NAME}>
                      <span className="mt-[3px] block h-2.5 w-20 rounded-sm bg-border motion-safe:animate-pulse" />
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
