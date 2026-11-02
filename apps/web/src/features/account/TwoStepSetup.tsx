import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { MfaSetupStart } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, PasswordInput } from '../../components/ui/form';
import { useMfaEnable, useMfaSetup } from './api';
import { QrCode } from './QrCode';

const fieldError = (err: unknown, field: string) =>
  err instanceof ApiError ? err.fieldErrors?.[field]?.[0] : undefined;

/** Shown once after setup and after replacing them: copy or download, then confirm. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `ClientFlow recovery codes. Each works once.\n\n${codes.join('\n')}\n`;
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="warning" title="Save these recovery codes now">
        If you lose your phone, each code signs you in once. They are shown only now; keep them in
        your password manager or printed somewhere safe.
      </Banner>
      <ol className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-alt p-4 font-mono text-sm text-text min-[400px]:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast.success('Recovery codes copied.'))
              .catch(() => toast.error('Copy failed. Select the codes and copy them instead.'))
          }
        >
          <Copy aria-hidden className="size-4" />
          Copy all
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'clientflow-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download aria-hidden className="size-4" />
          Download
        </Button>
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="size-[18px] accent-[var(--color-primary)]"
        />
        I have saved my recovery codes
      </label>
      <Button onClick={onDone} disabled={!saved} className="self-start">
        <Check aria-hidden className="size-4" />
        Done
      </Button>
    </div>
  );
}

/** Password, then scan and confirm a code, then save the recovery codes (ADR-069). */
export function TwoStepSetup({ onDone }: { onDone: () => void }) {
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [started, setStarted] = useState<MfaSetupStart | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;

  if (!started) {
    return (
      <form
        noValidate
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setup.mutate(password, { onSuccess: (s) => setStarted(s) });
        }}
      >
        <p className="text-sm text-muted">
          You need an authenticator app on your phone, such as Google Authenticator, Microsoft
          Authenticator or 1Password. First, confirm your password.
        </p>
        <Field label="Your password" required error={fieldError(setup.error, 'password')}>
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          loading={setup.isPending}
          loadingLabel="Checking…"
          className="self-start"
        >
          Continue
        </Button>
      </form>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate(code.replace(/\s/g, ''), { onSuccess: (r) => setCodes(r.recoveryCodes) });
      }}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <QrCode value={started.otpauthUrl} label="QR code to scan with your authenticator app" />
        <div className="min-w-0 flex-1 text-sm text-text">
          <p>1. In your authenticator app, add an account and scan this code.</p>
          <p className="mt-3 text-muted">Cannot scan it? Type this key instead:</p>
          <p className="mt-1 break-all rounded-md bg-surface-alt px-3 py-2 font-mono text-[13px] tracking-wide">
            {started.secret}
          </p>
          <p className="mt-3">2. Enter the 6-digit code the app shows.</p>
        </div>
      </div>
      <div className="max-w-xs">
        <Field label="Authentication code" required error={fieldError(enable.error, 'code')}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={7}
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
      </div>
      {enable.isError && !fieldError(enable.error, 'code') ? (
        <Banner tone="danger" title="Two-step sign-in was not turned on">
          {enable.error instanceof ApiError ? enable.error.message : 'Please try again.'}
        </Banner>
      ) : null}
      <Button
        type="submit"
        loading={enable.isPending}
        loadingLabel="Turning on…"
        className="self-start"
      >
        Turn on two-step sign-in
      </Button>
    </form>
  );
}
