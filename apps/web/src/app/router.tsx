import { useEffect, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { setUnauthenticatedHandler } from '../lib/api';
import { ErrorState } from '../components/ui/feedback';
import { SESSION_KEY, useSession } from '../features/auth/session';
import { LoginPage } from '../features/auth/LoginPage';
import { ActivateInvitePage } from '../features/auth/ActivateInvitePage';
import { ForgotPasswordPage, ResetPasswordPage } from '../features/auth/PasswordResetPages';
import { TeamPage } from '../features/team/TeamPage';
import { DealsPage } from '../features/deals/DealsPage';
import { DealDetailPage } from '../features/deals/DealDetailPage';
import { FollowUpsPage } from '../features/follow-ups/FollowUpsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LeadsListPage } from '../features/leads/LeadsListPage';
import { LeadDetailPage } from '../features/leads/LeadDetailPage';
import { ProposalsListPage } from '../features/proposals/ProposalsListPage';
import { ProposalDetailPage } from '../features/proposals/ProposalDetailPage';
import { ServicesPage } from '../features/services/ServicesPage';
import { PortalProposalsPage } from '../features/portal/PortalProposalsPage';
import { PortalProposalPage } from '../features/portal/PortalProposalPage';
import { homeFor } from '../features/auth/LoginPage';
import { NotFoundPage } from './NotFoundPage';
import { PortalShell } from './PortalShell';
import { AppShell } from './AppShell';

function FullPageLoader() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status">
      <span className="flex items-center gap-2 text-sm text-muted">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-primary" />
        Loading your workspace…
      </span>
    </div>
  );
}

/** Route guard. It only improves UX: the API rejects unauthenticated calls regardless. */
function RequireSession({ children, area }: { children: ReactNode; area: 'app' | 'portal' }) {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Any 401 from a signed-in request means the session ended (expired, revoked, deactivated).
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      qc.clear();
      qc.setQueryData(SESSION_KEY, null);
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}&expired=1`, {
        replace: true,
      });
    });
    return () => setUnauthenticatedHandler(null);
  }, [qc, navigate, location.pathname, location.search]);

  if (session.isPending) return <FullPageLoader />;
  if (session.isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <ErrorState
          title="We could not load your workspace"
          message={session.error.message}
          onRetry={() => session.refetch()}
          retrying={session.isFetching}
        />
      </div>
    );
  }
  if (!session.data) {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  // Staff never see the portal shell and portal users never see the staff app (spec §1.1).
  const inPortal = session.data.role === 'CLIENT';
  if (inPortal !== (area === 'portal')) return <Navigate to={homeFor(session.data.role)} replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/activate-invite', element: <ActivateInvitePage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    path: '/app',
    element: (
      <RequireSession area="app">
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'leads', element: <LeadsListPage /> },
      { path: 'leads/:id', element: <LeadDetailPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'deals', element: <DealsPage /> },
      { path: 'deals/:id', element: <DealDetailPage /> },
      { path: 'follow-ups', element: <FollowUpsPage /> },
      { path: 'proposals', element: <ProposalsListPage /> },
      { path: 'proposals/:id', element: <ProposalDetailPage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/portal',
    element: (
      <RequireSession area="portal">
        <PortalShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <PortalProposalsPage /> },
      { path: 'proposals', element: <Navigate to="/portal" replace /> },
      { path: 'proposals/:id', element: <PortalProposalPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage standalone /> },
]);
