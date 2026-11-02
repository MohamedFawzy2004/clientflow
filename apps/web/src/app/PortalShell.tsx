import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '../components/ui/brand';
import { useLogout, useSession } from '../features/auth/session';
import { cn } from '../lib/format';

/**
 * Client portal frame: no staff navigation, no internal data. Everything shown comes from the
 * /portal API, which is pinned to the user's own organization.
 */
export function PortalShell() {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
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
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between gap-3 px-4 md:px-6">
          <Link to="/portal" className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-text">{user.agency.name}</p>
            <p className="truncate text-xs text-muted">
              Client portal{user.clientOrg ? ` · ${user.clientOrg.name}` : ''}
            </p>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-text sm:inline">{user.name}</span>
            <Avatar name={user.name} size="sm" />
            <button
              type="button"
              onClick={signOut}
              disabled={logout.isPending}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-alt hover:text-text disabled:opacity-50"
            >
              <LogOut aria-hidden className="size-[18px]" />
            </button>
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto w-full max-w-[1100px] px-4 md:px-6">
          <ul className="-mb-px flex gap-1">
            {[
              { to: '/portal', label: 'Proposals', end: true },
              { to: '/portal/projects', label: 'Projects', end: false },
            ].map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium',
                      isActive ||
                        (l.end && location.pathname.startsWith('/portal/proposals')) ||
                        (!l.end && location.pathname.startsWith('/portal/deliverables'))
                        ? 'border-primary text-primary-strong'
                        : 'border-transparent text-muted hover:text-text',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main
        id="main"
        tabIndex={-1}
        key={location.pathname}
        className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-6 outline-none md:px-6 md:pt-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
