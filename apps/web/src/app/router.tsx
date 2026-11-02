import { useEffect, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { setUnauthenticatedHandler } from '../lib/api';
import { ErrorState } from '../components/ui/feedback';
import { SESSION_KEY, useSession } from '../features/auth/session';
import { homeFor, LoginPage } from '../features/auth/LoginPage';
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

/**
 * Route-level code splitting (M5): each screen is its own chunk, loaded when first visited.
 * Sign-in and the app shells stay in the main bundle so the first screen paints at once.
 */
function screen<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return async () => ({ Component: (await load())[name] as ComponentType });
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

const auth = () => import('../features/auth/PasswordResetPages');

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/app" replace />,
    hydrateFallbackElement: <FullPageLoader />,
  },
  { path: '/login', element: <LoginPage /> },
  {
    path: '/activate-invite',
    lazy: screen(() => import('../features/auth/ActivateInvitePage'), 'ActivateInvitePage'),
    hydrateFallbackElement: <FullPageLoader />,
  },
  {
    path: '/forgot-password',
    lazy: screen(auth, 'ForgotPasswordPage'),
    hydrateFallbackElement: <FullPageLoader />,
  },
  {
    path: '/reset-password',
    lazy: screen(auth, 'ResetPasswordPage'),
    hydrateFallbackElement: <FullPageLoader />,
  },
  {
    path: '/app',
    element: (
      <RequireSession area="app">
        <AppShell />
      </RequireSession>
    ),
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      {
        path: 'dashboard',
        lazy: screen(() => import('../features/dashboard/DashboardPage'), 'DashboardPage'),
      },
      {
        path: 'notifications',
        lazy: screen(
          () => import('../features/notifications/NotificationsPage'),
          'NotificationsPage',
        ),
      },
      {
        path: 'notifications/settings',
        lazy: screen(
          () => import('../features/notifications/NotificationSettingsPage'),
          'NotificationSettingsPage',
        ),
      },
      {
        path: 'imports',
        lazy: screen(() => import('../features/imports/ImportPage'), 'ImportPage'),
      },
      {
        path: 'reminders',
        lazy: screen(() => import('../features/dashboard/RemindersPage'), 'RemindersPage'),
      },
      {
        path: 'leads',
        lazy: screen(() => import('../features/leads/LeadsListPage'), 'LeadsListPage'),
      },
      {
        path: 'leads/:id',
        lazy: screen(() => import('../features/leads/LeadDetailPage'), 'LeadDetailPage'),
      },
      { path: 'team', lazy: screen(() => import('../features/team/TeamPage'), 'TeamPage') },
      { path: 'deals', lazy: screen(() => import('../features/deals/DealsPage'), 'DealsPage') },
      {
        path: 'deals/:id',
        lazy: screen(() => import('../features/deals/DealDetailPage'), 'DealDetailPage'),
      },
      {
        path: 'follow-ups',
        lazy: screen(() => import('../features/follow-ups/FollowUpsPage'), 'FollowUpsPage'),
      },
      {
        path: 'proposals',
        lazy: screen(() => import('../features/proposals/ProposalsListPage'), 'ProposalsListPage'),
      },
      {
        path: 'proposals/:id',
        lazy: screen(
          () => import('../features/proposals/ProposalDetailPage'),
          'ProposalDetailPage',
        ),
      },
      {
        path: 'projects',
        lazy: screen(() => import('../features/projects/ProjectsListPage'), 'ProjectsListPage'),
      },
      {
        path: 'projects/:id',
        lazy: screen(() => import('../features/projects/ProjectDetailPage'), 'ProjectDetailPage'),
        children: [
          {
            index: true,
            lazy: screen(() => import('../features/projects/ProjectOverview'), 'ProjectOverview'),
          },
          {
            path: 'board',
            lazy: screen(() => import('../features/delivery/TaskBoardPage'), 'TaskBoardPage'),
          },
          {
            path: 'deliverables',
            lazy: screen(() => import('../features/delivery/DeliverablesPage'), 'DeliverablesPage'),
          },
          {
            path: 'deliverables/:deliverableId',
            lazy: screen(() => import('../features/delivery/DeliverablePage'), 'DeliverablePage'),
          },
          {
            path: 'changes',
            lazy: screen(() => import('../features/changes/ChangesPage'), 'ChangesPage'),
          },
          {
            path: 'changes/:changeId',
            lazy: screen(() => import('../features/changes/ChangePage'), 'ChangePage'),
          },
          {
            path: 'files',
            lazy: screen(() => import('../features/delivery/FilesPage'), 'FilesPage'),
          },
          {
            path: 'time',
            lazy: screen(() => import('../features/delivery/TimePage'), 'TimePage'),
          },
        ],
      },
      {
        path: 'invoices',
        lazy: screen(() => import('../features/invoices/InvoicesPage'), 'InvoicesPage'),
      },
      {
        path: 'invoices/:id',
        lazy: screen(() => import('../features/invoices/InvoicePage'), 'InvoicePage'),
      },
      {
        path: 'reports/finance',
        lazy: screen(() => import('../features/invoices/FinanceReportPage'), 'FinanceReportPage'),
      },
      {
        path: 'finance/cost-rates',
        lazy: screen(() => import('../features/invoices/CostRatesPage'), 'CostRatesPage'),
      },
      {
        path: 'services',
        lazy: screen(() => import('../features/services/ServicesPage'), 'ServicesPage'),
      },
      {
        path: 'settings',
        lazy: screen(() => import('../features/settings/SettingsPage'), 'SettingsPage'),
      },
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
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      {
        index: true,
        lazy: screen(() => import('../features/portal/PortalProposalsPage'), 'PortalProposalsPage'),
      },
      { path: 'proposals', element: <Navigate to="/portal" replace /> },
      {
        path: 'proposals/:id',
        lazy: screen(() => import('../features/portal/PortalProposalPage'), 'PortalProposalPage'),
      },
      {
        path: 'projects',
        lazy: screen(() => import('../features/portal/PortalProjectsPage'), 'PortalProjectsPage'),
      },
      {
        path: 'projects/:id',
        lazy: screen(() => import('../features/portal/PortalProjectPage'), 'PortalProjectPage'),
      },
      {
        path: 'changes/:id',
        lazy: screen(() => import('../features/portal/PortalChangePage'), 'PortalChangePage'),
      },
      {
        path: 'invoices',
        lazy: screen(() => import('../features/portal/PortalInvoices'), 'PortalInvoicesPage'),
      },
      {
        path: 'invoices/:id',
        lazy: screen(() => import('../features/portal/PortalInvoices'), 'PortalInvoicePage'),
      },
      {
        path: 'deliverables/:id',
        lazy: screen(
          () => import('../features/portal/PortalDeliverablePage'),
          'PortalDeliverablePage',
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage standalone /> },
]);
