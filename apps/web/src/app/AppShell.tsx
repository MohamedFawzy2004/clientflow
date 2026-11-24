import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  ChevronDown,
  FileUp,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { can, ROLE_LABELS, type SessionUser } from '@clientflow/contracts';
import { toast } from 'sonner';
import { Avatar, Wordmark } from '../components/ui/brand';
import { DemoNotice } from '../components/DemoNotice';
import { RadixDialog } from '../components/ui/dialog';
import { cn } from '../lib/format';
import { useLogout, useSession } from '../features/auth/session';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useFollowUps } from '../features/deals/api';
import { CommandPalette } from './CommandPalette';
import { canSeeLeads, NAV, sectionFor, type NavGroup } from './nav';

export { canSeeLeads };

// Quick-create dialogs load only when first opened, so the shell chunk stays small (NFR-03).
const AddLeadDialog = lazy(() =>
  import('../features/leads/AddLeadDialog').then((m) => ({ default: m.AddLeadDialog })),
);
const DealFormDialog = lazy(() =>
  import('../features/deals/DealFormDialog').then((m) => ({ default: m.DealFormDialog })),
);

const COLLAPSE_KEY = 'cf.nav.collapsed';
const RAIL_KEY = 'cf.nav.rail';

/** `true`: icon rail below 1024 px only. `'always'`: the person chose the rail on desktop too. */
type Rail = boolean | 'always';
const hideOnRail = (rail?: Rail) =>
  rail === 'always' ? 'sr-only' : rail ? 'max-lg:sr-only' : undefined;

function readRail() {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Overdue + due today, from the same follow-up queue the Follow-ups page shows. */
function useFollowUpCounter(enabled: boolean) {
  const q = useFollowUps();
  if (!enabled || !q.data) return null;
  const { overdue, today } = q.data.data.counts;
  return { overdue, today, total: overdue + today };
}

function NavSection({
  group,
  user,
  rail,
  collapsed,
  onToggle,
  onNavigate,
  followUps,
}: {
  group: NavGroup;
  user: SessionUser;
  rail?: Rail;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  followUps: ReturnType<typeof useFollowUpCounter>;
}) {
  const listId = useId();
  const items = group.items.filter((i) => i.visible(user.role));
  if (items.length === 0) return null;
  // On the tablet rail the labels are hidden, so groups never collapse there.
  const hidden = collapsed && !rail;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!hidden}
        aria-controls={listId}
        className={cn(
          'group mb-1 flex h-8 w-full items-center justify-between rounded-md px-3 text-left text-xs font-medium text-nav-muted hover:text-white',
          hideOnRail(rail),
        )}
      >
        {group.label}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 opacity-60 transition-transform duration-150 group-hover:opacity-100',
            hidden && '-rotate-90',
          )}
        />
      </button>
      <ul id={listId} hidden={hidden} className="flex flex-col gap-px">
        {items.map(({ to, label, icon: Icon, counter }) => {
          const count = counter === 'follow-ups' ? followUps : null;
          return (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onNavigate}
                title={rail ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                    rail === 'always'
                      ? 'justify-center'
                      : rail && 'justify-center lg:justify-start',
                    isActive
                      ? 'bg-nav-active text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-mint'
                      : 'text-nav-text hover:bg-nav-raised hover:text-white',
                  )
                }
              >
                <Icon aria-hidden className="size-[18px] shrink-0" />
                <span className={cn('min-w-0 flex-1 truncate', hideOnRail(rail))}>{label}</span>
                {count && count.total > 0 ? (
                  <span
                    className={cn(
                      'tabular grid h-5 min-w-5 place-items-center rounded-sm px-1.5 text-[11px] font-semibold',
                      count.overdue > 0 ? 'bg-mint text-ink' : 'bg-nav-line text-nav-text',
                      rail === 'always'
                        ? 'absolute right-1 top-1'
                        : rail && 'absolute right-1 top-1 lg:static',
                    )}
                  >
                    <span aria-hidden>{count.total}</span>
                    <span className="sr-only">
                      {`: ${count.overdue} overdue, ${count.today} due today`}
                    </span>
                  </span>
                ) : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NavLinks({
  user,
  onNavigate,
  rail,
}: {
  user: SessionUser;
  onNavigate?: () => void;
  rail?: Rail;
}) {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const followUps = useFollowUpCounter(canSeeLeads(user.role));
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // Private windows may refuse storage; the toggle still works for this visit.
      }
      return next;
    });
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV.map((group) => (
        <NavSection
          key={group.id}
          group={group}
          user={user}
          rail={rail}
          collapsed={collapsed.includes(group.id)}
          onToggle={() => toggle(group.id)}
          onNavigate={onNavigate}
          followUps={followUps}
        />
      ))}
    </nav>
  );
}

function WorkspaceCard({ user, rail }: { user: SessionUser; rail?: Rail }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-nav-raised px-3 py-2.5',
        rail === 'always' ? 'hidden' : rail && 'hidden lg:block',
      )}
    >
      <p className="truncate text-[13px] font-semibold text-white">{user.agency.name}</p>
      <p className="truncate text-xs text-nav-muted">
        {user.agency.defaultCurrency} · {user.agency.timezone.replace('_', ' ')}
      </p>
    </div>
  );
}

function UserBlock({
  user,
  rail,
  onSignOut,
  signingOut,
}: {
  user: SessionUser;
  rail?: Rail;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1',
        rail === 'always' ? 'flex-col' : rail && 'flex-col lg:flex-row',
      )}
    >
      {/* Your name opens your account security (two-step sign-in, ADR-069). */}
      <Link
        to="/app/account"
        title="Account security"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-nav-raised"
      >
        <Avatar name={user.name} className="ring-2 ring-nav-line" />
        <span className={cn('min-w-0 flex-1', hideOnRail(rail))}>
          <span className="block truncate text-sm font-medium text-white">{user.name}</span>
          <span className="block truncate text-xs text-nav-muted">{ROLE_LABELS[user.role]}</span>
        </span>
        <span className="sr-only">, account security</span>
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-10 shrink-0 place-items-center rounded-md text-nav-muted transition-colors hover:bg-nav-raised hover:text-white disabled:opacity-50"
      >
        <LogOut aria-hidden className="size-[18px]" />
      </button>
    </div>
  );
}

function SearchButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        'press flex h-10 items-center gap-2.5 rounded-md border border-border bg-surface pl-3 pr-2 text-sm text-muted hover:border-border-strong hover:text-ink',
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">Search leads, deals, pages</span>
      <kbd className="rounded-sm border border-border bg-surface-alt px-1.5 text-[11px] font-medium text-muted">
        Ctrl K
      </kbd>
    </button>
  );
}

type CreateKind = 'lead' | 'deal' | null;

/** "Create" disclosure: only actions this role may take; each opens the existing dialog. */
function QuickCreate({ user, onCreate }: { user: SessionUser; onCreate: (k: CreateKind) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const canLead = can(user.role, 'contacts.create');
  const canDeal = can(user.role, 'deals.write') && canSeeLeads(user.role);
  const canImport = can(user.role, 'imports.run');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('[data-first]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canLead && !canDeal && !canImport) return null;
  const pick = (k: CreateKind) => {
    setOpen(false);
    onCreate(k);
  };
  const item =
    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-ink hover:bg-surface-alt focus-visible:bg-surface-alt';
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="press inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        <Plus aria-hidden className="size-4" />
        Create
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-60 origin-top-right rounded-lg border border-border bg-surface p-1.5 shadow-pop [animation:cf-pop-in_140ms_var(--ease-out)]"
        >
          {canLead ? (
            <button type="button" data-first className={item} onClick={() => pick('lead')}>
              <UserPlus aria-hidden className="size-4 text-subtle" />
              Add lead
            </button>
          ) : null}
          {canDeal ? (
            <button
              type="button"
              data-first={!canLead || undefined}
              className={item}
              onClick={() => pick('deal')}
            >
              <Plus aria-hidden className="size-4 text-subtle" />
              New deal
            </button>
          ) : null}
          {canImport ? (
            <Link
              to="/app/imports"
              className={item}
              onClick={() => setOpen(false)}
              data-first={!canLead && !canDeal ? true : undefined}
            >
              <FileUp aria-hidden className="size-4 text-subtle" />
              Import a CSV
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState<CreateKind>(null);
  const [railed, setRailed] = useState(readRail);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user) return null;
  const section = sectionFor(location.pathname);
  const rail: Rail = railed ? 'always' : true;
  const toggleRail = () =>
    setRailed((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? '0' : '1');
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      return !r;
    });

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => toast.success('You have been signed out.'),
      onError: () => toast.message('You have been signed out on this device.'),
      onSettled: () => navigate('/login', { replace: true }),
    });

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Forest sidebar: 72 px rail on tablets, 248 px from 1024 px, 264 px from 1440 px. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col bg-nav print:!hidden md:flex md:w-[72px]',
          !railed && 'lg:w-[248px] wide:w-[264px]',
        )}
      >
        <div className={cn('flex h-16 items-center px-4', !railed && 'lg:px-5')}>
          <Wordmark tone="nav" compact className={railed ? undefined : 'lg:hidden'} />
          {railed ? null : <Wordmark tone="nav" className="hidden lg:flex" />}
        </div>
        <div className="px-3 pb-2">
          <WorkspaceCard user={user} rail={rail} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-color:var(--color-nav-line)_transparent]">
          <NavLinks user={user} rail={rail} />
        </div>
        <div className={cn('border-t border-nav-line p-2', !railed && 'lg:p-3')}>
          <UserBlock user={user} rail={rail} onSignOut={signOut} signingOut={logout.isPending} />
          <button
            type="button"
            onClick={toggleRail}
            aria-pressed={railed}
            title={railed ? 'Show the full sidebar' : 'Collapse the sidebar to icons'}
            className="mt-1 hidden h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-medium text-nav-muted hover:bg-nav-raised hover:text-white lg:flex"
          >
            {railed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden className="size-4" />
            )}
            <span className={railed ? 'sr-only' : undefined}>
              {railed ? 'Show the full sidebar' : 'Collapse sidebar'}
            </span>
          </button>
        </div>
      </aside>

      {/* Phone top bar, 56 px, with a navigation drawer. */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-nav px-1.5 print:hidden md:hidden">
        <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <RadixDialog.Trigger
            className="grid size-11 place-items-center rounded-md text-white hover:bg-nav-raised"
            aria-label="Open navigation"
          >
            <Menu aria-hidden className="size-5" />
          </RadixDialog.Trigger>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/50 [animation:cf-fade-in_160ms_ease-out]" />
            <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col bg-nav shadow-pop [animation:cf-slide-in_240ms_var(--ease-drawer)]">
              <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
              <RadixDialog.Description className="sr-only">
                Main sections of ClientFlow
              </RadixDialog.Description>
              <div className="flex h-14 items-center justify-between pl-4 pr-1.5">
                <Wordmark tone="nav" />
                <RadixDialog.Close
                  className="grid size-11 place-items-center rounded-md text-nav-text hover:bg-nav-raised"
                  aria-label="Close navigation"
                >
                  <X aria-hidden className="size-5" />
                </RadixDialog.Close>
              </div>
              <div className="px-3">
                <WorkspaceCard user={user} />
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <NavLinks user={user} onNavigate={() => setDrawerOpen(false)} />
              </div>
              <div className="border-t border-nav-line p-3">
                <UserBlock user={user} onSignOut={signOut} signingOut={logout.isPending} />
              </div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
        <Link to="/app/dashboard" aria-label="ClientFlow dashboard" className="rounded-md">
          <Wordmark tone="nav" />
        </Link>
        <span className="flex items-center">
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search"
            className="grid size-11 place-items-center rounded-md text-nav-text hover:bg-nav-raised"
          >
            <Search aria-hidden className="size-[18px]" />
          </button>
          <span className="[&_a]:text-nav-text [&_a:hover]:bg-nav-raised [&_a:hover]:text-white">
            <NotificationBell />
          </span>
        </span>
      </header>

      <div className={cn('md:pl-[72px] print:!pl-0', !railed && 'lg:pl-[248px] wide:pl-[264px]')}>
        <header className="sticky top-0 z-20 hidden h-16 items-center gap-3 border-b border-border bg-bg/90 px-6 backdrop-blur print:!hidden md:flex wide:px-10">
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            {section ? (
              <>
                <span>{section.group.label}</span>
                <span aria-hidden className="mx-2 text-border-strong">
                  /
                </span>
                <span className="font-medium text-ink">{section.item.label}</span>
              </>
            ) : (
              <span className="font-medium text-ink">{user.agency.name}</span>
            )}
          </p>
          <SearchButton onOpen={openPalette} className="w-[min(340px,34vw)]" />
          <QuickCreate user={user} onCreate={setCreating} />
          <NotificationBell />
        </header>
        <div className="mx-auto w-full max-w-[1480px] px-4 md:px-6 wide:px-10">
          <DemoNotice user={user} className="mt-4" />
        </div>
        <main
          id="main"
          tabIndex={-1}
          key={location.pathname}
          className="mx-auto w-full max-w-[1480px] px-4 pb-28 pt-6 outline-none sm:pb-16 md:px-6 md:pt-8 wide:px-10"
        >
          <Outlet />
        </main>
      </div>

      {/* Phone quick-create: one thumb-reach button for the most common action. */}
      {can(user.role, 'contacts.create') ? (
        <button
          type="button"
          onClick={() => setCreating('lead')}
          className="press fixed bottom-5 right-4 z-20 inline-flex h-12 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-sm font-medium text-white shadow-pop print:hidden md:hidden"
        >
          <Plus aria-hidden className="size-5" />
          Add lead
        </button>
      ) : null}

      <CommandPalette user={user} open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Suspense fallback={null}>
        {creating === 'lead' ? (
          <AddLeadDialog open onOpenChange={(o) => !o && setCreating(null)} />
        ) : null}
        {creating === 'deal' ? (
          <DealFormDialog open onOpenChange={(o) => !o && setCreating(null)} />
        ) : null}
      </Suspense>
    </div>
  );
}
