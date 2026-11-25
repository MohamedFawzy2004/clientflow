import { cn, initials } from '../../lib/format';

/**
 * ClientFlow mark: two relationship nodes joined by a flowing line, on deep forest.
 * One path, so it stays crisp from 20 to 32 px.
 */
export function LogoMark({ className, inverse }: { className?: string; inverse?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect width="32" height="32" rx="7" fill={inverse ? '#64BBA1' : '#102C28'} />
      <path
        d="M8.5 21.5c4.2 0 5.3-11 9.6-11h5.4"
        stroke={inverse ? '#102C28' : '#64BBA1'}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="8.5" cy="21.5" r="2.6" fill={inverse ? '#102C28' : '#FFFFFF'} />
      <circle cx="23.5" cy="10.5" r="2.6" fill={inverse ? '#102C28' : '#FFFFFF'} />
    </svg>
  );
}

export function Wordmark({
  className,
  compact,
  tone = 'ink',
}: {
  className?: string;
  compact?: boolean;
  tone?: 'ink' | 'nav';
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark inverse={tone === 'nav'} />
      {compact ? (
        <span className="sr-only">ClientFlow</span>
      ) : (
        <span
          className={cn(
            'text-[17px] font-[650] tracking-[-0.02em]',
            tone === 'nav' ? 'text-white' : 'text-ink',
          )}
        >
          ClientFlow
        </span>
      )}
    </span>
  );
}

// Avatar tints come from the token families; each text/background pair is ≥ 4.5:1.
const avatarColors = [
  'bg-primary-soft text-primary-strong',
  'bg-violet-soft text-violet-strong',
  'bg-warning-soft text-warning',
  'bg-mint-soft text-ink',
  'bg-surface-alt text-ink',
];

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-[-0.01em]',
        size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-14 text-lg' : 'size-9 text-xs',
        avatarColors[hash % avatarColors.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
