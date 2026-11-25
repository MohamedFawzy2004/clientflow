import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/format';
import { Button } from './button';

type Tone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger';

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-surface-alt text-muted ring-border',
  primary: 'bg-primary-soft text-primary-strong ring-primary/20',
  info: 'bg-info-soft text-info ring-info/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/20',
};

/** Status chip. Always carries text, so meaning never depends on color alone (spec §7.4.19). */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-xs font-medium ring-1 ring-inset',
        badgeTones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-sm bg-[linear-gradient(90deg,#f3f1ec_0%,#e9e4db_50%,#f3f1ec_100%)] bg-[length:200%_100%] [animation:cf-shimmer_1.4s_ease-in-out_infinite]',
        className,
      )}
    />
  );
}

interface StateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: StateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-mint-soft text-primary-strong ring-1 ring-mint">
        {icon}
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
  retrying,
  className,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-6 py-14 text-center', className)}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-lg bg-danger-soft text-danger ring-1 ring-danger/15">
        <TriangleAlert aria-hidden className="size-5" />
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{message}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-muted">
          Reference:{' '}
          <code className="rounded-sm bg-surface-alt px-1.5 py-0.5 font-mono text-[11px]">
            {requestId}
          </code>
        </p>
      ) : null}
      {onRetry ? (
        <Button
          variant="secondary"
          className="mt-5"
          onClick={onRetry}
          loading={retrying}
          loadingLabel="Retrying…"
        >
          <RefreshCw aria-hidden className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

const bannerTones = {
  danger: { cls: 'border-danger/25 bg-danger-soft text-danger', Icon: TriangleAlert },
  warning: { cls: 'border-warning/30 bg-warning-soft text-warning', Icon: TriangleAlert },
  info: { cls: 'border-info/25 bg-info-soft text-info', Icon: Info },
  success: { cls: 'border-success/25 bg-success-soft text-success', Icon: CircleCheck },
} as const;

/** Inline message for form-level errors and warnings. */
export function Banner({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof bannerTones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = bannerTones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-md border px-3.5 py-3 text-sm', cls, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-text">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'mt-0.5', 'text-[13px] leading-5 text-text/85')}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Mounts `children` once the placeholder comes within 200 px of the viewport, or once the
 * browser is idle after the first screen, whichever comes first. Below-the-fold dashboard sections
 * use it so their requests and chunks do not compete with the first screen on a phone; nothing is
 * removed, it only arrives a moment later. Without IntersectionObserver it renders at once.
 */
export function DeferredSection({
  children,
  placeholderClassName = 'h-80',
}: {
  children: ReactNode;
  placeholderClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (shown || !ref.current) return;
    const show = () => setShown(true);
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && show(),
      // Start a little before it scrolls into view, so it is usually ready on arrival.
      { rootMargin: '0px 0px 200px 0px' },
    );
    io.observe(ref.current);
    // Fallback: once the browser is idle after the first screen, load it anyway, so it is ready
    // before the person scrolls and anything that reads the page (tests, assistive tech) finds it.
    const idle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(show, { timeout: 2000 })
        : window.setTimeout(show, 1200);
    return () => {
      io.disconnect();
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [shown]);
  if (shown) return <>{children}</>;
  return (
    <div ref={ref}>
      <Skeleton className={cn('w-full rounded-lg', placeholderClassName)} />
    </div>
  );
}
