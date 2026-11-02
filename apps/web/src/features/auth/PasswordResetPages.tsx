import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { CircleCheck, MailCheck } from 'lucide-react';
import { newPasswordSchema, passwordResetRequestSchema } from '@clientflow/contracts';
import { api, ApiError, setCsrfToken } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState } from '../../components/ui/feedback';
import { Field, Input, PasswordInput } from '../../components/ui/form';
import { InvalidLink } from './ActivateInvitePage';
import { AuthCard, useFragmentToken } from './AuthCard';

const backToSignIn = (
  <Link to="/login" className="font-medium text-primary-strong hover:underline">
    Back to sign in
  </Link>
);

export function ForgotPasswordPage() {
  const request = useMutation({
    mutationFn: (values: { email: string }) => {
      setCsrfToken(null);
      return api.post('/api/v1/auth/password-reset/request', values, { skipAuthRedirect: true });
    },
  });
  const form = useForm<{ email: string }>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: '' },
    // Validate on submit, then live: blur validation shifts the layout under the pointer.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  if (request.isSuccess) {
    return (
      <AuthCard title="Check your email" footer={backToSignIn}>
        <EmptyState
          className="px-0 py-2"
          icon={<MailCheck aria-hidden className="size-5" />}
          title="If that address has an account, a link is on its way"
          description="The link works once and expires in 30 minutes. Check spam if it does not arrive. For privacy, we never confirm whether an email is registered."
        />
      </AuthCard>
    );
  }

  const err = request.error instanceof ApiError ? request.error : null;
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your work email and we will send you a reset link."
      footer={backToSignIn}
    >
      {err ? (
        <Banner
          tone="danger"
          className="mb-5"
          title={err.code === 'RATE_LIMITED' ? 'Too many requests' : 'Something went wrong'}
        >
          {err.code === 'RATE_LIMITED'
            ? 'Wait a few minutes before asking for another link.'
            : err.message}
        </Banner>
      ) : null}
      <form
        onSubmit={form.handleSubmit((v) => request.mutate(v))}
        noValidate
        className="flex flex-col gap-5"
      >
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {(p) => (
            <Input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoFocus
              {...form.register('email')}
            />
          )}
        </Field>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={request.isPending}
          loadingLabel="Sending…"
        >
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

const resetSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  });
type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const confirm = useMutation({
    mutationFn: (values: ResetValues) => {
      setCsrfToken(null);
      return api.post(
        '/api/v1/auth/password-reset/confirm',
        { token, password: values.password },
        { skipAuthRedirect: true },
      );
    },
  });
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
    // Validate on submit, then live: blur validation shifts the layout under the pointer.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;
  const err = confirm.error instanceof ApiError ? confirm.error : null;

  if (!token || err?.code === 'TOKEN_INVALID') {
    return (
      <AuthCard title="Reset your password" footer={backToSignIn}>
        <InvalidLink kind="reset" />
      </AuthCard>
    );
  }
  if (confirm.isSuccess) {
    return (
      <AuthCard title="Password updated">
        <EmptyState
          className="px-0 py-2"
          icon={<CircleCheck aria-hidden className="size-5" />}
          title="You can sign in with your new password"
          description="For your security, you were signed out on every device."
          action={
            <Link
              to="/login"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
            >
              Sign in
            </Link>
          }
        />
      </AuthCard>
    );
  }

  const onSubmit = form.handleSubmit((values) =>
    confirm.mutate(values, {
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.password)
          form.setError('password', { message: e.fieldErrors.password[0] });
      },
    }),
  );

  return (
    <AuthCard title="Choose a new password" footer={backToSignIn}>
      {err && !err.fieldErrors.password ? (
        <Banner tone="danger" className="mb-5" title="Password not changed">
          {err.message}
        </Banner>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field
          label="New password"
          required
          hint="At least 12 characters. A few unrelated words work well."
          error={errors.password?.message}
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              autoFocus
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm new password" required error={errors.confirm?.message}>
          {(p) => (
            <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />
          )}
        </Field>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={confirm.isPending}
          loadingLabel="Saving…"
        >
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}
