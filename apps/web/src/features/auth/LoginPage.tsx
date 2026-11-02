import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { loginRequestSchema, type LoginRequest } from '@clientflow/contracts';
import { FileCheck2, GitBranch, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/ui/feedback';
import { Field, Input } from '../../components/ui/form';
import { Wordmark } from '../../components/ui/brand';
import { useLogin, useSession } from './session';

/** Only internal app paths are accepted, so `next` cannot become an open redirect. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/app') || next.startsWith('//') || next.includes('\\'))
    return '/app/dashboard';
  return next;
}

function loginErrorMessage(err: unknown): { title: string; body?: string } {
  if (!(err instanceof ApiError)) return { title: 'Something went wrong. Please try again.' };
  switch (err.code) {
    case 'UNAUTHENTICATED':
      return { title: 'Email or password is incorrect.', body: 'Check both and try again.' };
    case 'RATE_LIMITED':
      return {
        title: 'Too many sign-in attempts.',
        body: 'For your security, wait a few minutes before trying again.',
      };
    case 'NETWORK':
    case 'TIMEOUT':
      return { title: 'We could not reach ClientFlow.', body: err.message };
    case 'CSRF_INVALID':
      return { title: 'Your sign-in form expired.', body: 'Please try again.' };
    default:
      return {
        title: err.message,
        body: err.requestId ? `Reference: ${err.requestId}` : undefined,
      };
  }
}

const HIGHLIGHTS = [
  {
    icon: GitBranch,
    title: 'One flow from lead to delivery',
    body: 'Keep client context when a deal becomes a project.',
  },
  {
    icon: FileCheck2,
    title: 'Scope you can defend',
    body: 'Versioned proposals and recorded approvals.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by default',
    body: 'Every record is checked against your role on the server.',
  },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const login = useLogin();
  const next = safeNextPath(params.get('next'));
  const expired = params.get('expired') === '1';

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });
  const { errors } = form.formState;

  if (session.data) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(next, { replace: true }),
      onError: () => form.setValue('password', ''),
    }),
  );

  const failure = login.isError ? loginErrorMessage(login.error) : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden border-r border-border bg-[#0f2a33] px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(8,127,114,0.55),transparent_60%),radial-gradient(90%_70%_at_100%_100%,rgba(40,89,169,0.35),transparent_60%)]" />
        <div className="relative flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-8">
            <rect width="32" height="32" rx="9" fill="#fff" fillOpacity="0.12" />
            <path
              d="M9 11.5a3 3 0 0 1 3-3h4.5M23 20.5a3 3 0 0 1-3 3h-4.5M9 16h14"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="20.5" cy="8.5" r="2.2" fill="#fff" />
            <circle cx="11.5" cy="23.5" r="2.2" fill="#fff" />
          </svg>
          <span className="text-[17px] font-semibold tracking-[-0.01em]">ClientFlow</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[32px] font-semibold leading-[38px] tracking-[-0.02em]">
            Run your agency from first inquiry to final invoice.
          </h2>
          <ul className="mt-10 flex flex-col gap-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-[15px] font-medium">{title}</span>
                  <span className="mt-0.5 block text-sm text-white/70">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/55">
          Internal workspace · invited team members only
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <Wordmark className="mb-10 lg:hidden" />
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[28px] md:leading-9">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm text-muted">Use the email your agency admin invited.</p>

          <div className="mt-6 flex flex-col gap-3" aria-live="polite">
            {expired && !failure ? (
              <Banner tone="info" title="Your session ended.">
                Sign in again to continue where you left off.
              </Banner>
            ) : null}
            {failure ? (
              <Banner tone="danger" title={failure.title}>
                {failure.body}
              </Banner>
            ) : null}
          </div>

          <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
            <Field label="Email" required error={errors.email?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  autoFocus
                  {...form.register('email')}
                />
              )}
            </Field>
            <Field label="Password" required error={errors.password?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  {...form.register('password')}
                />
              )}
            </Field>
            <Button
              type="submit"
              size="lg"
              className="mt-1 w-full"
              loading={login.isPending}
              loadingLabel="Signing in…"
            >
              Sign in
            </Button>
          </form>

          <p className="mt-8 border-t border-border pt-5 text-xs leading-[18px] text-muted">
            There is no public sign-up. Forgot your password? Ask your agency owner or admin.
            Self-service reset arrives with team management.
          </p>
        </div>
      </section>
    </div>
  );
}
