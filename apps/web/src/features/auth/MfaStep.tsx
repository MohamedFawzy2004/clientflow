import { useState } from 'react';
import type { Role } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/ui/feedback';
import { Field, Input } from '../../components/ui/form';
import { useMfaVerify } from './session';

/**
 * Second sign-in step (ADR-069). Five wrong tries or five minutes end the attempt, and the
 * person starts again from the password.
 */
export function MfaStep({
  onSignedIn,
  onRestart,
}: {
  onSignedIn: (role: Role) => void;
  onRestart: () => void;
}) {
  const verify = useMfaVerify();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');

  const expired = verify.error instanceof ApiError && verify.error.code === 'TOKEN_INVALID';
  const fieldError =
    verify.error instanceof ApiError && verify.error.code === 'VALIDATION_FAILED'
      ? (verify.error.fieldErrors?.code?.[0] ?? verify.error.fieldErrors?.recoveryCode?.[0])
      : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, '') };
    verify.mutate(input, { onSuccess: (data) => onSignedIn(data.user.role) });
  };

  if (expired) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Banner tone="info" title="That sign-in attempt ended.">
          It took too long or had too many wrong codes. Enter your password again.
        </Banner>
        <Button onClick={onRestart}>Back to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
      <p className="text-sm text-muted">
        {useRecovery
          ? 'Enter one of the recovery codes you saved when you turned on two-step sign-in. Each works once.'
          : 'Open your authenticator app and enter the 6-digit code for ClientFlow.'}
      </p>
      <Field
        label={useRecovery ? 'Recovery code' : 'Authentication code'}
        required
        error={fieldError}
      >
        {(p) => (
          <Input
            {...p}
            key={useRecovery ? 'recovery' : 'code'}
            autoFocus
            autoComplete={useRecovery ? 'off' : 'one-time-code'}
            inputMode={useRecovery ? 'text' : 'numeric'}
            maxLength={useRecovery ? 16 : 7}
            placeholder={useRecovery ? 'ABCD-EFGH-JKLM' : '123 456'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      {verify.isError && !fieldError ? (
        <Banner tone="danger" title="We could not check that code.">
          {verify.error instanceof ApiError ? verify.error.message : 'Please try again.'}
        </Banner>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={verify.isPending}
        loadingLabel="Checking…"
      >
        Verify and sign in
      </Button>
      <button
        type="button"
        className="self-start text-[13px] font-medium text-primary-strong hover:underline"
        onClick={() => {
          setUseRecovery((r) => !r);
          setValue('');
          verify.reset();
        }}
      >
        {useRecovery ? 'Use a code from the app instead' : 'Use a recovery code instead'}
      </button>
    </form>
  );
}
