import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Briefcase,
  CalendarClock,
  LayoutDashboard,
  LogOut,
  Menu,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { can, canAny, ROLE_LABELS, type Role, type SessionUser } from '@clientflow/contracts';
import { toast } from 'sonner';
import { Avatar, Wordmark } from '../components/ui/brand';
import { RadixDialog } from '../components/ui/dialog';
import { cn } from '../lib/format';
import { useLogout, useSession } from '../features/auth/session';

/** UI hint only: the API enforces the same matrix on every request (ADR-009). */
export function canSeeLeads(role: Role) {
  return canAny(role, ['contacts.read.all', 'contacts.read.own']);
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  visible: (role: Role) => boolean;
}

// Only shipped, working sections appear. Later modules join the nav when they exist.
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Home',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: () => true },
    ],
  },
  {
    group: 'Sales',
    items: [
      { to: '/app/follow-ups', label: 'Follow-ups', icon: CalendarClock, visible: canSeeLeads },
      { to: '/app/leads', label: 'Leads', icon: Users, visible: canSeeLeads },
      {
        to: '/app/deals',
        label: 'Deals',
        icon: Briefcase,
        visible: (r) => canAny(r, ['deals.read.all', 'deals.read.own']),
      },
    ],
  },
  {
    group: 'Workspace',
    items: [{ to: '/app/team', label: 'Team', icon: UserCog, visible: (r) => can(r, 'team.read') }],
  },
];

function NavLinks({
  user,
  onNavigate,
  rail,
}: {
  user: SessionUser;
  onNavigate?: () => void;
  rail?: boolean;
}) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map(({ group, items }) => {
        const visible = items.filter((i) => i.visible(user.role));
        if (visible.length === 0) return null;
        return (
          <div key={group}>
            <p
              className={cn(
                'mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
                rail && 'sr-only lg:not-sr-only',
              )}
            >
              {group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {visible.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onNavigate}
                    title={rail ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        rail && 'justify-center lg:justify-start',
                        isActive
                          ? 'bg-primary-soft text-primary-strong'
                          : 'text-muted hover:bg-surface-alt hover:text-text',
                      )
                    }
                  >
                    <Icon aria-hidden className="size-[18px] shrink-0" />
                    <span className={cn(rail && 'sr-only lg:not-sr-only')}>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserBlock({
  user,
  rail,
  onSignOut,
  signingOut,
}: {
  user: SessionUser;
  rail?: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg p-2', rail && 'flex-col lg:flex-row')}>
      <Avatar name={user.name} />
      <div className={cn('min-w-0 flex-1', rail && 'hidden lg:block')}>
        <p className="truncate text-sm font-medium text-text">{user.name}</p>
        <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-10 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-alt hover:text-text disabled:opacity-50"
      >
        <LogOut aria-hidden className="size-[18px]" />
      </button>
    </div>
  );
}

export function AppShell() {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!user) return null;

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

      {/* Sidebar: 72px rail on tablets, 232px on laptops, 252px from 1440px (spec §7.3). */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface md:flex md:w-[72px] lg:w-[232px] wide:w-[252px]">
        <div className="flex h-16 items-center px-4 lg:px-5">
          <Wordmark compact className="lg:hidden" />
          <Wordmark className="hidden lg:flex" />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks user={user} rail />
        </div>
        <div className="border-t border-border p-2 lg:p-3">
          <UserBlock user={user} rail onSignOut={signOut} signingOut={logout.isPending} />
        </div>
      </aside>

      {/* Mobile top bar, 56px, with a navigation drawer. */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-2 backdrop-blur md:hidden">
        <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <RadixDialog.Trigger
            className="grid size-11 place-items-center rounded-md text-text hover:bg-surface-alt"
            aria-label="Open navigation"
          >
            <Menu aria-hidden className="size-5" />
          </RadixDialog.Trigger>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[#0b1726]/45 [animation:cf-fade-in_160ms_ease-out]" />
            <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col bg-surface shadow-pop [animation:cf-slide-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]">
              <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
              <RadixDialog.Description className="sr-only">
                Main sections of ClientFlow
              </RadixDialog.Description>
              <div className="flex h-14 items-center justify-between border-b border-border pl-4 pr-2">
                <Wordmark />
                <RadixDialog.Close
                  className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-alt"
                  aria-label="Close navigation"
                >
                  <X aria-hidden className="size-5" />
                </RadixDialog.Close>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <NavLinks user={user} onNavigate={() => setDrawerOpen(false)} />
              </div>
              <div className="border-t border-border p-3">
                <UserBlock user={user} onSignOut={signOut} signingOut={logout.isPending} />
              </div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
        <Wordmark />
        <span className="grid size-11 place-items-center">
          <Avatar name={user.name} size="sm" />
        </span>
      </header>

      <div className="md:pl-[72px] lg:pl-[232px] wide:pl-[252px]">
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-border bg-bg/90 px-6 backdrop-blur md:flex wide:px-8">
          <p className="truncate text-sm text-muted">
            <span className="font-medium text-text">{user.agency.name}</span>
            <span aria-hidden className="mx-2 text-border-strong">
              /
            </span>
            <span>
              {user.agency.defaultCurrency} · {user.agency.timezone.replace('_', ' ')}
            </span>
          </p>
        </header>
        <main
          id="main"
          tabIndex={-1}
          key={location.pathname}
          className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-6 outline-none sm:pb-16 md:px-6 md:pt-8 wide:px-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
