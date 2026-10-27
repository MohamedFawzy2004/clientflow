import { INVOICE_STATUS_LABELS, type InvoiceDisplayStatus } from '@clientflow/contracts';
import { Badge } from '../ui/feedback';

const TONE = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  VOID: 'neutral',
  OVERDUE: 'danger',
} as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return <Badge tone={TONE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}

/** Made clear on every screen that shows invoices: ClientFlow tracks, it does not collect. */
export const NOT_ACCOUNTING_NOTICE =
  'ClientFlow tracks invoices and payments you confirm. It does not process payments and is not accounting software.';
