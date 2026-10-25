import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Layers, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  CURRENCIES,
  minorToDecimalString,
  serviceCreateSchema,
  type Currency,
  type ServiceCreateInput,
  type ServiceSummary,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Money } from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { useProposalPermissions, useServiceAction, useServices } from '../proposals/api';

function ServiceDialog({
  service,
  onClose,
}: {
  service: ServiceSummary | 'new';
  onClose: () => void;
}) {
  const { data: user } = useSession();
  const action = useServiceAction();
  const existing = service === 'new' ? null : service;
  const form = useForm<ServiceCreateInput>({
    resolver: zodResolver(serviceCreateSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          unit: existing.unit,
          rate: minorToDecimalString(existing.rateMinor, existing.currency),
          currency: existing.currency,
        }
      : {
          name: '',
          description: '',
          unit: 'hour',
          rate: '',
          currency: (user?.agency.defaultCurrency ?? 'EGP') as Currency,
        },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    const done = {
      onSuccess: () => {
        toast.success(existing ? 'Service updated' : 'Service added');
        onClose();
      },
      onError: (err: unknown) => {
        if (err instanceof ApiError) {
          for (const [field, messages] of Object.entries(err.fieldErrors)) {
            form.setError(field as keyof ServiceCreateInput, { message: messages[0] });
          }
        }
      },
    };
    if (existing) {
      action.mutate(
        { kind: 'update', id: existing.id, body: { ...values, version: existing.version } },
        done,
      );
    } else {
      action.mutate({ kind: 'create', body: values }, done);
    }
  });
  const error =
    action.error instanceof ApiError && action.error.code !== 'VALIDATION_FAILED'
      ? action.error
      : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title={existing ? 'Edit service' : 'Add service'}
      description="Proposals copy the name and price when a line is added, so edits here never change proposals already written."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="service-form"
            loading={action.isPending}
            loadingLabel="Saving…"
          >
            {existing ? 'Save changes' : 'Add service'}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" title="Not saved" className="mb-5">
          {error.code === 'CONFLICT_STALE_VERSION'
            ? 'Someone else changed this service. Close the dialog to see their version.'
            : error.message}
        </Banner>
      ) : null}
      <form
        id="service-form"
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2"
      >
        <Field label="Name" required error={errors.name?.message} className="sm:col-span-2">
          {(p) => <Input {...p} maxLength={160} data-autofocus {...form.register('name')} />}
        </Field>
        <Field label="Rate" required error={errors.rate?.message}>
          {(p) => <Input {...p} inputMode="decimal" {...form.register('rate')} />}
        </Field>
        <Field label="Currency" required error={errors.currency?.message}>
          {(p) => (
            <Select {...p} {...form.register('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Charged per"
          required
          hint="e.g. hour, day, page, month"
          error={errors.unit?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} maxLength={40} {...form.register('unit')} />}
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={3} maxLength={2000} {...form.register('description')} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function ServicesPage() {
  const perms = useProposalPermissions();
  const [showArchived, setShowArchived] = useState(false);
  const query = useServices(showArchived);
  const action = useServiceAction();
  const [editing, setEditing] = useState<ServiceSummary | 'new' | null>(null);
  const error = query.error instanceof ApiError ? query.error : null;

  const archive = (s: ServiceSummary) =>
    action.mutate(
      { kind: s.archivedAt ? 'restore' : 'archive', id: s.id, version: s.version },
      {
        onSuccess: () => toast.success(s.archivedAt ? 'Service restored' : 'Service archived'),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Not saved'),
      },
    );

  let body;
  if (!perms.readServices || error?.status === 403) {
    body = (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="The service catalog is not part of your role"
      />
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (query.isPending) {
    body = (
      <div aria-busy className="flex flex-col gap-3 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else if (query.data.data.length === 0) {
    body = (
      <EmptyState
        icon={<Layers aria-hidden className="size-5" />}
        title="No services yet"
        description={
          perms.manageServices
            ? 'Add the services you sell so proposals can be built from them.'
            : 'An owner or admin adds the services you sell.'
        }
        action={
          perms.manageServices ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden className="size-4" /> Add service
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:gap-4 md:px-5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                <span className="min-w-0 break-words">{s.name}</span>
                {s.archivedAt ? <Badge>Archived</Badge> : null}
              </p>
              {s.description ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{s.description}</p>
              ) : null}
            </div>
            <p className="text-sm text-text">
              <Money minor={s.rateMinor} currency={s.currency} className="font-medium" />{' '}
              <span className="text-muted">per {s.unit}</span>
            </p>
            {perms.manageServices ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                  Edit<span className="sr-only"> {s.name}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => archive(s)}
                  disabled={action.isPending}
                >
                  {s.archivedAt ? 'Restore' : 'Archive'}
                  <span className="sr-only"> {s.name}</span>
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Services
          </h1>
          <p className="mt-1 text-sm text-muted">
            What you sell, with default rates for proposals.
          </p>
        </div>
        {perms.manageServices ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" /> Add service
          </Button>
        ) : null}
      </div>
      <label className="mt-5 flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived services
      </label>
      <section
        aria-label="Services"
        className="mt-4 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {body}
      </section>
      {editing ? <ServiceDialog service={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
