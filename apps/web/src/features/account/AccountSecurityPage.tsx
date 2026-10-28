import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Badge, Banner } from '../../components/ui/feedback';
import { Field, Input, PasswordInput } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useMfaDisable, useMfaRegenerate } from './api';
import { RecoveryCodes, TwoStepSetup } from './TwoStepSetup';

const fieldError = (err: unknown, field: string) =>
  err instanceof ApiError ? err.fieldErrors?.[field]?.[0] : undefined;

/** Password and a current code, for changes to an account that already uses two-step sign-in. */
function Confirm({
  submitLabel,
  danger,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  danger?: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (input: { password: string; code: string }) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  return (
    <form
      noValidate
      className="flex max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ password, code: code.replace(/\s/g, '') });
      }}
    >
      <Field label="Your password" required error={fieldError(error, 'password')}>
        {(p) => (
          <PasswordInput
            {...p}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="Authentication code" required error={fieldError(error, 'code')}>
        {(p) => (
          <Input
            {...p}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
      </Field>
      {error instanceof ApiError && !fieldError(error, 'password') && !fieldError(error, 'code') ? (
        <Banner tone="danger" title={error.message} />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The person's own sign-in security (ADR-069). */
export function AccountSecurityPage() {
  const { data: user } = useSession();
  const regenerate = useMfaRegenerate();
  const disable = useMfaDisable();
  const [mode, setMode] = useState<'idle' | 'setup' | 'regenerate' | 'disable'>('idle');
  const [codes, setCodes] = useState<string[] | null>(null);
  if (!user) return null;
  const { enabled, required } = user.mfa;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[28px]">
          Account security
        </h1>
        <p className="mt-1 text-sm text-muted">Signed in as {user.email}.</p>
      </div>
      <Card
        title="Two-step sign-in"
        action={enabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
      >
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : mode === 'setup' ? (
          <TwoStepSetup
            onDone={() => {
              setMode('idle');
              toast.success('Two-step sign-in is on.');
            }}
          />
        ) : mode === 'regenerate' ? (
          <Confirm
            submitLabel="Replace recovery codes"
            pending={regenerate.isPending}
            error={regenerate.error}
            onCancel={() => setMode('idle')}
            onSubmit={(input) =>
              regenerate.mutate(input, {
                onSuccess: (r) => {
                  setMode('idle');
                  setCodes(r.recoveryCodes);
                },
              })
            }
          />
        ) : mode === 'disable' ? (
          <Confirm
            submitLabel="Turn off two-step sign-in"
            danger
            pending={disable.isPending}
            error={disable.error}
            onCancel={() => setMode('idle')}
            onSubmit={(input) =>
              disable.mutate(input, {
                onSuccess: () => {
                  setMode('idle');
                  toast.success('Two-step sign-in is off.');
                },
              })
            }
          />
        ) : enabled ? (
          <div className="flex flex-col gap-4 text-sm text-text">
            <p className="flex items-start gap-2">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              Signing in needs your password and a code from your authenticator app.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMode('regenerate')}>
                Replace recovery codes
              </Button>
              {required ? null : (
                <Button variant="secondary" onClick={() => setMode('disable')}>
                  <ShieldOff aria-hidden className="size-4" />
                  Turn off
                </Button>
              )}
            </div>
            {required ? (
              <p className="text-xs text-muted">
                Your role requires two-step sign-in, so it stays on.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-text">
            <p>
              Add a second step to signing in: a code from an app on your phone. Someone who learns
              your password still cannot get in.
            </p>
            <Button className="self-start" onClick={() => setMode('setup')}>
              Turn on two-step sign-in
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
