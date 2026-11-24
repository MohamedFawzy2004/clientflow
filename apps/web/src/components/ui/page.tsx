import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/format';

/** Every route gets its own browser-tab title (WCAG 2.4.2). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ClientFlow`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Page heading block. One h1 per page, optional trail of parent pages, a one-line purpose and
 * the page's own actions on the right (they wrap under the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
  className,
  documentTitle,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Small facts under the title (status chips, owner). */
  meta?: ReactNode;
  className?: string;
  /** Browser-tab title when `title` is not plain text. */
  documentTitle?: string;
}) {
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : null));
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 max-w-3xl">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {c.to ? (
                    <Link to={c.to} className="hover:text-ink hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                  <ChevronRight aria-hidden className="size-3.5 text-subtle" />
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="page-title min-w-0 break-words">{title}</h1>
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">{meta}</div>
        ) : null}
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled region of a page. Panels sit on white with a warm hairline; no drop shadow, so depth
 * is reserved for things that float (menus, drawers, dialogs).
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  id,
  tone = 'surface',
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
  id?: string;
  tone?: 'surface' | 'sunk';
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Tag
      aria-labelledby={title && headingId ? headingId : undefined}
      className={cn(
        'min-w-0 rounded-lg border border-border',
        tone === 'surface' ? 'bg-surface' : 'bg-surface-alt/70',
        className,
      )}
    >
      {title || action ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-1 pt-4">
          <div className="min-w-0">
            {title ? (
              <h2 id={headingId} className="text-[15px] font-[620] leading-6 text-ink">
                {title}
              </h2>
            ) : null}
            {description ? <p className="text-[13px] leading-5 text-muted">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {/* bodyClassName replaces the default padding (cn is plain clsx, so classes would not override). */}
      <div className={bodyClassName ?? (title || action ? 'px-5 pb-5 pt-3' : 'p-5')}>
        {children}
      </div>
    </Tag>
  );
}

/** Toggle group for views and filters: buttons with aria-pressed, 40 px tall (44 on phones). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-0.5 rounded-md border border-border bg-surface-alt p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-medium md:h-8',
            value === o.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,45,42,0.12)]'
              : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A label/value pair for detail sidebars. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-text">{children}</dd>
    </div>
  );
}
