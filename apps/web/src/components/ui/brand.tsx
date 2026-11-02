import { cn, initials } from '../../lib/format';

/** ClientFlow mark: two connected nodes on a flow line (spec §7.1). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect width="32" height="32" rx="9" fill="#087F72" />
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
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {compact ? (
        <span className="sr-only">ClientFlow</span>
      ) : (
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-text">
          Client<span className="text-primary">Flow</span>
        </span>
      )}
    </span>
  );
}

const avatarColors = [
  'bg-[#E6F4F2] text-[#056B61]',
  'bg-[#EAF1FB] text-[#2859A9]',
  'bg-[#FDF4E3] text-[#7A5000]',
  'bg-[#F1ECFB] text-[#5B3BA8]',
  'bg-[#FCEBED] text-[#9A1D2B]',
];

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-xs',
        avatarColors[hash % avatarColors.length],
      )}
    >
      {initials(name)}
    </span>
  );
}
