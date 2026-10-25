import type { ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { Banner } from './feedback';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  tone?: 'danger' | 'primary';
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
}

/** Confirmation for sensitive actions (spec §7.4.7). Stays open with the error if it fails. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  tone = 'danger',
  pending,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={pending}
            loadingLabel={pendingLabel}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" title="That did not work" className="mb-4">
          {error}
        </Banner>
      ) : null}
      {children}
    </Dialog>
  );
}
