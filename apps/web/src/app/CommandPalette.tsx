import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CornerDownLeft, LoaderCircle, Search, User } from 'lucide-react';
import {
  canAny,
  formatMoney,
  type ApiSuccess,
  type ContactSummary,
  type DealSummary,
  type SessionUser,
} from '@clientflow/contracts';
import { api } from '../lib/api';
import { cn } from '../lib/format';
import { canSeeLeads, NAV } from './nav';

interface Option {
  id: string;
  group: 'Go to' | 'Leads and clients' | 'Deals';
  label: string;
  detail?: string;
  icon: typeof User;
  href: string;
}

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Global search and jump-to (Ctrl/⌘ K). Searches the same list endpoints the Leads and Deals pages
 * use (`?q=`), so results are scoped by the API exactly as those pages are. No open/close
 * animation: a palette is opened many times a day (design-system doc, motion rules).
 */
export function CommandPalette({
  user,
  open,
  onOpenChange,
}: {
  user: SessionUser;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 180);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const leadsAllowed = canSeeLeads(user.role);
  const dealsAllowed = canAny(user.role, ['deals.read.all', 'deals.read.own']);
  const searching = open && q.length >= 2;

  const contacts = useQuery({
    queryKey: ['u', user.id, 'palette', 'contacts', q],
    enabled: searching && leadsAllowed,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ContactSummary[]>>(`/api/v1/contacts?limit=5&q=${encodeURIComponent(q)}`, {
        signal,
      }),
  });
  const deals = useQuery({
    queryKey: ['u', user.id, 'palette', 'deals', q],
    enabled: searching && dealsAllowed,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<DealSummary[]>>(`/api/v1/deals?limit=5&q=${encodeURIComponent(q)}`, {
        signal,
      }),
  });

  const options = useMemo<Option[]>(() => {
    const needle = query.trim().toLowerCase();
    const pages: Option[] = NAV.flatMap((g) =>
      g.items
        .filter((i) => i.visible(user.role))
        .filter(
          (i) =>
            !needle || `${i.label} ${g.label} ${i.keywords ?? ''}`.toLowerCase().includes(needle),
        )
        .map((i) => ({
          id: `page:${i.to}`,
          group: 'Go to' as const,
          label: i.label,
          detail: g.label,
          icon: i.icon,
          href: i.to,
        })),
    ).slice(0, needle ? 6 : 8);
    if (!searching) return pages;
    const people: Option[] = (contacts.data?.data ?? []).map((c) => ({
      id: `contact:${c.id}`,
      group: 'Leads and clients',
      label: c.fullName,
      detail: [c.companyName, c.lifecycle === 'CUSTOMER' ? 'Client' : 'Lead']
        .filter(Boolean)
        .join(', '),
      icon: User,
      href: `/app/leads/${c.id}`,
    }));
    const opps: Option[] = (deals.data?.data ?? []).map((d) => ({
      id: `deal:${d.id}`,
      group: 'Deals',
      label: d.title,
      detail: `${formatMoney(d.amountMinor, d.currency)}, ${d.status === 'OPEN' ? d.stage.name : d.status === 'WON' ? 'Won' : 'Lost'}`,
      icon: Briefcase,
      href: `/app/deals/${d.id}`,
    }));
    return [...people, ...opps, ...pages];
  }, [query, searching, contacts.data, deals.data, user.role]);

  const close = (o: boolean) => {
    if (!o) setQuery('');
    onOpenChange(o);
  };
  const go = (o: Option | undefined) => {
    if (!o) return;
    close(false);
    navigate(o.href);
  };
  const loading = searching && (contacts.isFetching || deals.isFetching);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  let lastGroup = '';
  return (
    <RadixDialog.Root open={open} onOpenChange={close}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RadixDialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[min(560px,76dvh)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-border"
        >
          <RadixDialog.Title className="sr-only">Search ClientFlow</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">
            Type a name, company or deal. Use the arrow keys to choose and Enter to open.
          </RadixDialog.Description>
          <div className="flex items-center gap-3 border-b border-border px-4">
            {loading ? (
              <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin text-subtle" />
            ) : (
              <Search aria-hidden className="size-5 shrink-0 text-subtle" />
            )}
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options[active] ? optionId(active) : undefined}
              aria-label="Search leads, deals and pages"
              value={query}
              maxLength={100}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  go(options[active]);
                }
              }}
              placeholder="Search leads, deals or jump to a page"
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
            />
            <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted sm:block">
              Esc
            </kbd>
          </div>
          <ul id={listId} role="listbox" aria-label="Results" className="overflow-y-auto p-2">
            {options.length === 0 ? (
              <li role="presentation" className="px-3 py-8 text-center text-sm text-muted">
                {searching && !loading
                  ? `Nothing matches “${q}” in what you can see.`
                  : 'Type at least 2 characters to search.'}
              </li>
            ) : (
              options.map((o, i) => {
                const header = o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                const Icon = o.icon;
                return (
                  <li key={o.id} role="presentation">
                    {header ? (
                      <p
                        role="presentation"
                        className="px-3 pb-1 pt-3 text-xs font-medium text-muted first:pt-1"
                      >
                        {header}
                      </p>
                    ) : null}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      tabIndex={-1}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(o)}
                      onKeyDown={() => undefined}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5',
                        i === active ? 'bg-primary-soft' : '',
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          'size-4 shrink-0',
                          i === active ? 'text-primary-strong' : 'text-subtle',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {o.label}
                        </span>
                        {o.detail ? (
                          <span className="block truncate text-xs text-muted">{o.detail}</span>
                        ) : null}
                      </span>
                      {i === active ? (
                        <CornerDownLeft aria-hidden className="size-4 text-primary-strong" />
                      ) : null}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            Results follow your access: you only see leads and deals your role allows.
          </p>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
