import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CostRateView,
  InvoiceDetail,
  PortalInvoiceDetail,
  ProjectFinance,
  SessionUser,
} from '@clientflow/contracts';
import { InvoicePage } from '../src/features/invoices/InvoicePage';
import { CostRatesPage } from '../src/features/invoices/CostRatesPage';
import { PortalInvoicePage } from '../src/features/portal/PortalInvoices';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown, status = 200) => ({ status, body: { data, meta: { requestId: 'r' } } });
const FINANCE: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000fa',
  role: 'FINANCE',
};
const ADMIN: SessionUser = { ...USER, id: '018f0000-0000-7000-8000-0000000000ad', role: 'ADMIN' };
const CLIENT: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000cc',
  role: 'CLIENT',
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
};

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'i1',
  reference: 'Draft',
  number: null,
  status: 'DRAFT',
  displayStatus: 'DRAFT',
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
  project: { id: 'p1', title: 'Fleet app' },
  currency: 'EGP',
  dueOn: '2026-11-30',
  issuedOn: null,
  totalMinor: '0',
  paidMinor: '0',
  balanceMinor: '0',
  published: false,
  version: 3,
  taxRateBp: 1400,
  subtotalMinor: '0',
  taxMinor: '0',
  terms: null,
  internalNote: null,
  billedTo: null,
  issuer: null,
  items: [],
  payments: [],
  voidReason: null,
  access: { edit: true, issue: false, publish: false, void: true, recordPayment: false },
  ...over,
});

const finance: ProjectFinance = {
  currency: 'EGP',
  expectedMinor: '5000000',
  invoicedMinor: '0',
  invoicedTotalMinor: '0',
  receivedMinor: '0',
  outstandingMinor: '0',
  cost: {
    estimatedMinor: '0',
    minutesCosted: 0,
    minutesTotal: 0,
    completenessPercent: 100,
    missingRates: [],
  },
  estimatedMarginMinor: '5000000',
  scope: 'full',
  billable: {
    currency: 'EGP',
    budgetMinor: '5000000',
    invoicedMinor: '0',
    milestones: [
      {
        id: '018f0000-0000-7000-8000-00000000aa01',
        title: 'Design',
        status: 'DONE',
        invoiced: false,
      },
    ],
    changes: [
      {
        id: '018f0000-0000-7000-8000-00000000cc01',
        reference: 'CR-1',
        title: 'Arabic version',
        priceMinor: '1250050',
        invoiced: false,
      },
    ],
  },
};

function renderInvoice(
  user: SessionUser,
  inv: InvoiceDetail,
  pay?: (n: number) => { status: number; body?: unknown },
) {
  let payments = 0;
  const calls = mockFetch((url, init) => {
    if (url.endsWith('/projects/p1/finance')) return ok(finance);
    if (url.endsWith('/payments') && init.method === 'POST')
      return pay ? pay(++payments) : ok(inv, 201);
    return ok(inv);
  });
  renderRoute(<InvoicePage />, { path: '/app/invoices/:id', url: '/app/invoices/i1', user });
  return calls;
}

describe('invoice draft (FR-F01, FR-F02)', () => {
  it('adds a line from an accepted change, shows exact totals and saves the whole draft', async () => {
    const calls = renderInvoice(FINANCE, invoice());
    await userEvent.selectOptions(
      await screen.findByLabelText('Add from the project'),
      'C:018f0000-0000-7000-8000-00000000cc01',
    );
    expect(screen.getByLabelText('Line 1 description')).toHaveValue('CR-1 Arabic version');
    expect(screen.getByLabelText('Line 1 unit price (EGP)')).toHaveValue('12500.50');
    await userEvent.clear(screen.getByLabelText('Line 1 quantity'));
    await userEvent.type(screen.getByLabelText('Line 1 quantity'), '3');
    // 3 × 12,500.50 = 37,501.50; 14% tax = 5,250.21 (half up); total 42,751.71.
    const totals = screen.getByText('Subtotal').closest('dl')!;
    expect(within(totals).getByText(/37,501\.50/)).toBeInTheDocument();
    expect(within(totals).getByText(/5,250\.21/)).toBeInTheDocument();
    expect(within(totals).getByText(/42,751\.71/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.init.method === 'PUT')!;
    expect(put.url).toContain('/invoices/i1/draft');
    expect(JSON.parse(put.init.body as string)).toEqual({
      version: 3,
      dueOn: '2026-11-30',
      taxRatePercent: '14',
      terms: null,
      internalNote: null,
      items: [
        {
          description: 'CR-1 Arabic version',
          quantity: '3',
          unitPrice: '12500.50',
          source: 'CHANGE',
          sourceId: '018f0000-0000-7000-8000-00000000cc01',
        },
      ],
    });
  });
});

const issued = (over: Partial<InvoiceDetail> = {}) =>
  invoice({
    reference: 'INV-0001',
    number: 1,
    status: 'ISSUED',
    displayStatus: 'ISSUED',
    issuedOn: '2026-10-27',
    subtotalMinor: '1000000',
    taxMinor: '140000',
    totalMinor: '1140000',
    balanceMinor: '1140000',
    billedTo: { name: 'Harbour Co.', contact: null },
    issuer: { name: 'Lumen Digital Studio', details: null },
    items: [
      {
        id: 'l1',
        position: 0,
        description: 'Design',
        quantity: '1',
        quantityCenti: 100,
        unitPriceMinor: '1000000',
        lineTotalMinor: '1000000',
        source: 'OTHER',
        sourceId: null,
      },
    ],
    access: { edit: false, issue: false, publish: true, void: true, recordPayment: true },
    ...over,
  });

describe('payments (FR-F03, FR-F04, SEC-15)', () => {
  it('a retry after a failed answer reuses the idempotency key, so it cannot pay twice', async () => {
    const calls = renderInvoice(FINANCE, issued(), (n) =>
      n === 1 ? { status: 503, body: errorBody('UNAVAILABLE', 'Try again.') } : ok(issued(), 201),
    );
    const amount = await screen.findByLabelText(/^Amount \(EGP\)/);
    expect(amount).toHaveValue('11400.00');
    await userEvent.clear(amount);
    await userEvent.type(amount, '5000');
    await userEvent.type(screen.getByLabelText(/^Reference/), 'TRX-88');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/payments')).length).toBe(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/payments')).length).toBe(2));
    const [first, second] = calls.filter((c) => c.url.endsWith('/payments'));
    const key = (c: typeof first) => new Headers(c!.init.headers).get('Idempotency-Key');
    expect(key(first)).toMatch(/^[0-9a-f-]{36}$/);
    expect(key(second)).toBe(key(first));
    expect(JSON.parse(second!.init.body as string)).toMatchObject({
      amount: '5000',
      method: 'BANK_TRANSFER',
      reference: 'TRX-88',
    });
  });

  it('an admin manages the invoice but cannot record or reverse payments', async () => {
    renderInvoice(
      ADMIN,
      issued({
        status: 'PARTIALLY_PAID',
        displayStatus: 'PARTIALLY_PAID',
        paidMinor: '100000',
        balanceMinor: '1040000',
        payments: [
          {
            id: 'pay1',
            kind: 'PAYMENT',
            amountMinor: '100000',
            receivedOn: '2026-10-27',
            method: 'CASH',
            reference: null,
            note: null,
            recordedBy: 'Fadi',
            createdAt: '2026-10-27T09:00:00.000Z',
            reversedBy: null,
          },
        ],
        access: { edit: false, issue: false, publish: true, void: true, recordPayment: false },
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Show in client portal' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/recorded by Fadi/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
  });
});

describe('portal invoice (FR-X03)', () => {
  it('shows what is paid and open, without internal notes or staff names', async () => {
    const inv: PortalInvoiceDetail = {
      id: 'i1',
      reference: 'INV-0001',
      displayStatus: 'PARTIALLY_PAID',
      project: { id: 'p1', title: 'Fleet app' },
      currency: 'EGP',
      issuedOn: '2026-10-27',
      dueOn: '2026-11-30',
      totalMinor: '1140000',
      paidMinor: '500000',
      balanceMinor: '640000',
      taxRateBp: 1400,
      subtotalMinor: '1000000',
      taxMinor: '140000',
      terms: 'Bank transfer within 30 days.',
      billedTo: { name: 'Harbour Co.', contact: 'Omar' },
      issuer: { name: 'Lumen Digital Studio', details: null },
      items: [
        {
          description: 'Design',
          quantity: '1',
          unitPriceMinor: '1000000',
          lineTotalMinor: '1000000',
        },
      ],
      payments: [{ receivedOn: '2026-10-28', amountMinor: '500000', method: 'BANK_TRANSFER' }],
    };
    mockFetch(() => ok(inv));
    renderRoute(<PortalInvoicePage />, {
      path: '/portal/invoices/:id',
      url: '/portal/invoices/i1',
      user: CLIENT,
    });
    expect(await screen.findByRole('heading', { name: 'INV-0001' })).toBeInTheDocument();
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
    expect(screen.getByText(/6,400\.00/)).toBeInTheDocument();
    expect(screen.getByText(/does not take payments/)).toBeInTheDocument();
    expect(screen.queryByText(/Internal/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay|reverse/i })).not.toBeInTheDocument();
  });
});

describe('cost rates (FR-F06)', () => {
  it('finance reads rates but only owners and admins can set them', async () => {
    const rates: CostRateView[] = [
      {
        user: { id: 'u1', name: 'Mona', role: 'MEMBER' },
        current: { hourlyMinor: '25000', currency: 'EGP', effectiveFrom: '2026-10-01' },
        history: [
          { hourlyMinor: '25000', currency: 'EGP', effectiveFrom: '2026-10-01', setBy: 'Olivia' },
        ],
      },
      { user: { id: 'u2', name: 'Sami', role: 'MEMBER' }, current: null, history: [] },
    ];
    mockFetch(() => ok(rates));
    const view = renderRoute(<CostRatesPage />, { user: FINANCE });
    expect(await screen.findByText(/250\.00 an hour/)).toBeInTheDocument();
    expect(screen.getByText(/No rate yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set rate/ })).not.toBeInTheDocument();
    view.unmount();
    mockFetch(() => ok(rates));
    renderRoute(<CostRatesPage />, { user: ADMIN });
    expect(await screen.findByRole('button', { name: 'Set rate for Mona' })).toBeInTheDocument();
  });
});
