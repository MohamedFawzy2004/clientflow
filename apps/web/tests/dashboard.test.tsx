import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SalesDashboard, SessionUser } from '@clientflow/contracts';
import { SalesDashboard as SalesDashboardSection } from '../src/features/dashboard/SalesDashboard';
import { NotificationBell } from '../src/features/notifications/NotificationBell';
import { mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const dashboard = (over: Partial<SalesDashboard> = {}): SalesDashboard => ({
  range: { from: '2026-10-01', to: '2026-10-25', timeZone: 'Africa/Cairo' },
  owner: { id: USER.id, name: USER.name },
  pipeline: { openDeals: 3, totals: { EGP: '800000', USD: '5000' } },
  won: { count: 2, totals: { EGP: '930000' } },
  lost: { count: 1 },
  winRatePercent: 67,
  newLeads: 4,
  proposals: {
    inReview: 1,
    awaitingClient: 2,
    expiringIn7Days: 1,
    accepted: 0,
    acceptedTotals: {},
  },
  followUps: { overdue: 2, dueToday: 1 },
  byOwner: null,
  ...over,
});
const ok = (data: unknown) => ({ status: 200, body: { data, meta: { requestId: 'r' } } });

describe('sales dashboard', () => {
  it('shows per-currency totals side by side and the win rate with its counts', async () => {
    mockFetch(() => ok(dashboard()));
    renderRoute(<SalesDashboardSection />, { path: '/app/dashboard', url: '/app/dashboard' });
    const pipeline = await screen.findByRole('region', { name: 'Open pipeline' });
    expect(within(pipeline).getByText('3')).toBeInTheDocument();
    expect(within(pipeline).getByText(/EGP\s8,000\.00/)).toBeInTheDocument();
    expect(within(pipeline).getByText(/USD\s50\.00/)).toBeInTheDocument();
    const rate = screen.getByRole('region', { name: 'Win rate' });
    expect(within(rate).getByText('67%')).toBeInTheDocument();
    expect(within(rate).getByText(/2 won · 1 lost/)).toBeInTheDocument();
    expect(screen.getByText(/your records/)).toBeInTheDocument();
  });

  it('salespeople get no owner filter and no export', async () => {
    mockFetch(() => ok(dashboard()));
    renderRoute(<SalesDashboardSection />, { path: '/app/dashboard', url: '/app/dashboard' });
    await screen.findByRole('region', { name: 'Open pipeline' });
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Export deals/ })).not.toBeInTheDocument();
  });

  it('managers get the owner filter, the export link with the same filters, and the owner table', async () => {
    const manager: SessionUser = { ...USER, role: 'SALES_MANAGER' };
    const calls = mockFetch((url) =>
      url.includes('assignable-owners')
        ? ok([{ id: 'o1', name: 'Sami Ahmed', role: 'SALES' }])
        : ok(
            dashboard({
              owner: null,
              byOwner: [
                {
                  owner: { id: 'o1', name: 'Sami Ahmed' },
                  openDeals: 2,
                  openTotals: { EGP: '100000' },
                  won: 1,
                  wonTotals: { EGP: '30000' },
                },
              ],
            }),
          ),
    );
    renderRoute(<SalesDashboardSection />, {
      path: '/app/dashboard',
      url: '/app/dashboard?from=2026-10-01&to=2026-10-20',
      user: manager,
    });
    expect(await screen.findByLabelText('Owner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export deals/ })).toHaveAttribute(
      'href',
      '/api/v1/exports/deals.csv?from=2026-10-01&to=2026-10-20',
    );
    expect(
      within(await screen.findByRole('region', { name: 'By owner' })).getByText('Sami Ahmed'),
    ).toBeInTheDocument();
    expect(
      calls.some((c) => c.url.includes('/api/v1/dashboard/sales?from=2026-10-01&to=2026-10-20')),
    ).toBe(true);
  });
});

describe('notification bell (M10 replaces the reminder bell)', () => {
  it('announces the unread count and opens the notification center', async () => {
    mockFetch(() => ok({ count: 3 }));
    renderRoute(<NotificationBell />, { path: '/app', url: '/app' });
    expect(await screen.findByRole('link', { name: 'Notifications: 3 unread' })).toHaveAttribute(
      'href',
      '/app/notifications',
    );
  });

  it('is shown to every staff role and hidden in the portal role', async () => {
    mockFetch(() => ok({ count: 0 }));
    renderRoute(<NotificationBell />, {
      path: '/app',
      url: '/app',
      user: { ...USER, role: 'FINANCE' },
    });
    expect(await screen.findByRole('link', { name: 'Notifications: none unread' })).toBeVisible();
  });

  it('is hidden for client users', () => {
    mockFetch(() => ok({ count: 0 }));
    renderRoute(<NotificationBell />, {
      path: '/app',
      url: '/app',
      user: { ...USER, role: 'CLIENT' },
    });
    expect(screen.queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument();
  });
});
