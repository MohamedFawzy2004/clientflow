import { FlaskConical } from 'lucide-react';
import { ROLE_LABELS, type DemoAccount, type Role } from '@clientflow/contracts';
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

/**
 * The public demo's sign-in (ADR-071): pick a role, no password. Shown only when the server is a
 * demo deployment and has demo people to offer.
 */
export function DemoSignIn({
  accounts,
  onSignedIn,
}: {
  accounts: DemoAccount[];
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
        <ul className="mt-2 grid grid-cols-2 gap-2">
          {accounts.map((a) => (
            <li key={a.role}>
              <Button
                variant="secondary"
                className="h-auto min-h-11 w-full flex-col items-start justify-center gap-0 whitespace-normal px-3 py-2 text-left"
                aria-label={`Explore as ${ROLE_LABELS[a.role]} (${a.name}): ${ROLE_HINTS[a.role]}`}
                title={ROLE_HINTS[a.role]}
                loading={pending === a.role}
                loadingLabel="Signing in…"
                disabled={signIn.isPending && pending !== a.role}
                onClick={() =>
                  signIn.mutate({ role: a.role }, { onSuccess: (d) => onSignedIn(d.user.role) })
                }
              >
                <span className="text-sm font-medium leading-5 text-text">
                  {ROLE_LABELS[a.role]}
                </span>
                <span className="text-xs font-normal leading-4 text-muted">{a.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
