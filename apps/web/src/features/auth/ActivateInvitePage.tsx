import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { LoaderCircle, MailX } from 'lucide-react';
import { toast } from 'sonner';
import {
  newPasswordSchema,
  ROLE_LABELS,
  type ApiSuccess,
  type InvitationPreview,
  type LoginResponse,
} from '@clientflow/contracts';
import { api, ApiError, setCsrfToken } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState } from '../../components/ui/feedback';
import { Field, Input, PasswordInput } from '../../components/ui/form';
import { AuthCard, useFragmentToken } from './AuthCard';
import { homeFor } from './LoginPage';
import { SESSION_KEY, useSession } from './session';

const formSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter your name.')
      .max(120, 'Name must be 120 characters or fewer.'),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  });
type FormValues = z.infer<typeof formSchema>;

export function InvalidLink({ kind }: { kind: 'invitation' | 'reset' }) {
  return (
    <EmptyState
      className="px-0 py-4"
      icon={<MailX aria-hidden className="size-5" />}
      title={
        kind === 'invitation'
          ? 'This invitation link does not work'
          : 'This reset link does not work'
      }
      description={
        kind === 'invitation'
          ? 'It may have expired, been replaced by a newer invitation, or already been used. Ask your agency admin to resend it.'
          : 'It may have expired (links last 30 minutes), been replaced by a newer one, or already been used.'
      }
      action={
        kind === 'reset' ? (
          <Link
            to="/forgot-password"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Request a new link
          </Link>
        ) : (
          <Link to="/login" className="text-sm font-medium text-primary-strong hover:underline">
            Go to sign in
          </Link>
        )
      }
    />
  );
}

export function ActivateInvitePage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    queryFn: () =>
      api.post<ApiSuccess<InvitationPreview>>(
        '/api/v1/invitations/preview',
        { token },
        { skipAuthRedirect: true },
      ),
  });

  const accept = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<ApiSuccess<LoginResponse>>(
        '/api/v1/invitations/accept',
        { token, name: values.name, password: values.password },
        { skipAuthRedirect: true },
      ),
    onSuccess: (res) => {
      qc.clear();
      setCsrfToken(res.data.csrfToken);
      qc.setQueryData(SESSION_KEY, res.data.user);
      toast.success(`Welcome to ${res.data.user.agency.name}`);
      navigate(homeFor(res.data.user.role), { replace: true });
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', password: '', confirm: '' },
    // Validate on submit, then live: blur validation shifts the layout under the pointer.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;

  if (!token) {
    return (
      <AuthCard title="Accept invitation">
        <InvalidLink kind="invitation" />
      </AuthCard>
    );
  }
  if (preview.isPending) {
    return (
      <AuthCard title="Accept invitation">
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-primary" />
          Checking your invitation…
        </p>
      </AuthCard>
    );
  }
  if (preview.isError) {
    const err = preview.error instanceof ApiError ? preview.error : null;
    return (
      <AuthCard title="Accept invitation">
        {err?.code === 'TOKEN_INVALID' || err?.code === 'VALIDATION_FAILED' ? (
          <InvalidLink kind="invitation" />
        ) : (
          <ErrorState
            className="px-0 py-4"
            message={preview.error.message}
            onRetry={() => preview.refetch()}
            retrying={preview.isFetching}
          />
        )}
      </AuthCard>
    );
  }

  const invite = preview.data.data;
  const acceptError = accept.error instanceof ApiError ? accept.error : null;
  const onSubmit = form.handleSubmit((values) =>
    accept.mutate(values, {
      onError: (err) => {
        if (err instanceof ApiError && err.fieldErrors.password) {
          form.setError('password', { message: err.fieldErrors.password[0] });
        }
      },
    }),
  );

  return (
    <AuthCard
      title={
        invite.clientOrgName ? `${invite.agencyName} client portal` : `Join ${invite.agencyName}`
      }
      subtitle={
        invite.clientOrgName ? (
          <>
            You were invited to review proposals for{' '}
            <span className="font-medium text-text">{invite.clientOrgName}</span>. This invitation
            expires on {formatDate(invite.expiresAt)}.
          </>
        ) : (
          <>
            You were invited as{' '}
            <span className="font-medium text-text">{ROLE_LABELS[invite.role]}</span>. This
            invitation expires on {formatDate(invite.expiresAt)}.
          </>
        )
      }
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-strong hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-3" aria-live="polite">
        {session.data ? (
          <Banner tone="warning" title={`You are signed in as ${session.data.email}`}>
            Accepting this invitation signs you out of that account on this browser.
          </Banner>
        ) : null}
        {acceptError?.code === 'TOKEN_INVALID' ? <InvalidLink kind="invitation" /> : null}
        {acceptError &&
        acceptError.code !== 'TOKEN_INVALID' &&
        !acceptError.fieldErrors.password ? (
          <Banner tone="danger" title="Could not create your account">
            {acceptError.message}
          </Banner>
        ) : null}
      </div>
      {acceptError?.code === 'TOKEN_INVALID' ? null : (
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-5">
          <Field
            label="Email"
            required
            hint="Your sign-in email is the one this invitation was sent to."
          >
            {(p) => (
              <Input {...p} value={invite.email} readOnly className="bg-surface-alt text-muted" />
            )}
          </Field>
          <Field label="Your name" required error={errors.name?.message}>
            {(p) => <Input {...p} autoComplete="name" data-autofocus {...form.register('name')} />}
          </Field>
          <Field
            label="Password"
            required
            hint="At least 12 characters. A few unrelated words work well, e.g. “amber orchard signal”."
            error={errors.password?.message}
          >
            {(p) => (
              <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />
            )}
          </Field>
          <Field label="Confirm password" required error={errors.confirm?.message}>
            {(p) => (
              <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={accept.isPending}
            loadingLabel="Creating your account…"
          >
            Create account and sign in
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
