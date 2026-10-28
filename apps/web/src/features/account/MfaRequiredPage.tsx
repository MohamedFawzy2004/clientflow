import { LogOut, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ROLE_LABELS } from '@clientflow/contracts';
import { Button } from '../../components/ui/button';
import { Wordmark } from '../../components/ui/brand';
import { homeFor } from '../auth/LoginPage';
import { useLogout, useSession } from '../auth/session';
import { TwoStepSetup } from './TwoStepSetup';

/**
 * Shown instead of the app until a role that requires two-step sign-in has it on (ADR-069).
 * The API refuses everything else meanwhile (MFA_SETUP_REQUIRED), so this is not the only guard.
 */
export function MfaRequiredPage() {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-bg px-4 py-10">
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <Wordmark />
          <Button
            variant="secondary"
            onClick={() =>
              logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
            }
          >
            <LogOut aria-hidden className="size-4" />
            Sign out
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card md:p-6">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold leading-7 text-text">
            <ShieldAlert aria-hidden className="size-5 text-warning" />
            Turn on two-step sign-in to continue
          </h1>
          <p className="mt-2 text-sm text-muted">
            Your role{user ? ` (${ROLE_LABELS[user.role]})` : ''} needs a second step when signing
            in, because it can change the whole workspace. It takes about two minutes.
          </p>
          <div className="mt-6">
            <TwoStepSetup onDone={() => navigate(homeFor(user?.role), { replace: true })} />
          </div>
        </div>
      </main>
    </div>
  );
}
