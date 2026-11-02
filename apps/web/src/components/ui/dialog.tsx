import { useRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/format';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Accessible modal (focus trap, Escape, focus return). Width min(560px, 100vw - 32px).
 * Height never exceeds the viewport: the body scrolls and the footer stays visible (spec §7.3).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  // Radix returns focus to its own Trigger, but these dialogs are opened by ordinary buttons.
  // Remember whatever was focused when the dialog opened and restore it on close (WCAG 2.4.3).
  // Initial focus goes to the first `[data-autofocus]` field. React's autoFocus is not used,
  // because it moves focus before the opener can be recorded.
  const returnFocus = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[#0b1726]/45 backdrop-blur-[2px] [animation:cf-fade-in_160ms_ease-out]" />
        <RadixDialog.Content
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            returnFocus.current = document.activeElement as HTMLElement | null;
            const first = contentRef.current?.querySelector<HTMLElement>('[data-autofocus]');
            if (first) {
              event.preventDefault();
              first.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-xl bg-surface shadow-pop ring-1 ring-border [animation:cf-pop-in_180ms_cubic-bezier(0.2,0.8,0.2,1)]',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pb-4 pt-5 md:px-6">
            <div className="min-w-0">
              <RadixDialog.Title className="text-lg font-semibold leading-7 text-text">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-alt hover:text-text"
              aria-label="Close"
            >
              <X aria-hidden className="size-5" />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-alt/50 px-5 py-4 sm:flex-row sm:justify-end md:px-6">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export { RadixDialog };
