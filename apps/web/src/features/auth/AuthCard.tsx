import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { clearFragment, readTokenFromFragment } from '../../lib/api';
import { Wordmark } from '../../components/ui/brand';

/** Centered layout for signed-out flows (invite, forgot, reset). */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <Link to="/login" className="mb-8 inline-flex rounded-md" aria-label="ClientFlow sign in">
          <Wordmark />
        </Link>
        <div className="rounded-xl border border-border bg-surface p-5 shadow-card sm:p-8">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-text">
            {title}
          </h1>
          {subtitle ? <div className="mt-1.5 text-sm text-muted">{subtitle}</div> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Token from the URL fragment, read once and then removed from the address bar. */
export function useFragmentToken() {
  const [token] = useState(readTokenFromFragment);
  useEffect(() => clearFragment(), []);
  return token;
}
