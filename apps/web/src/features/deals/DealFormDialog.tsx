import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import {
  CURRENCIES,
  isCurrency,
  minorToDecimalString,
  parseMoneyToMinor,
  utcIsoToZonedLocal,
  zonedLocalToUtcIso,
  type Currency,
  type DealDetail,
  type DealUpdateInput,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { useLeads } from '../leads/api';
import { useCreateDeal, useDealAction, usePipeline } from './api';

interface FormValues {
  contactId: string;
  title: string;
  amount: string;
  currency: Currency;
  stageId: string;
  expectedCloseOn: string;
  nextStep: string;
  nextStepLocal: string;
}

/** Picks a lead from the user's own scope (the server checks it again). */
function ContactPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const leads = useLeads({ page: 1, limit: 25, q: q.trim() || undefined });
  const rows = leads.data?.data ?? [];
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <Field label="Search leads" hint="Type a name or company to narrow the list.">
        {(p) => (
          <Input
            {...p}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-autofocus
          />
        )}
      </Field>
      <Field label="Lead or customer" required error={error}>
        {(p) => (
          <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">
              {leads.isPending ? 'Loading…' : rows.length ? 'Choose…' : 'No matches'}
            </option>
            {rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.companyName ? ` · ${c.companyName}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function DealFormDialog({
  open,
  onOpenChange,
  contact,
  deal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fixed contact when opened from a lead page. */
  contact?: { id: string; fullName: string };
  /** Present when editing. */
  deal?: DealDetail;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const timeZone = session.data?.agency.timezone ?? 'Africa/Cairo';
  const agencyCurrency = session.data?.agency.defaultCurrency ?? 'EGP';
  const pipeline = usePipeline();
  const create = useCreateDeal();
  const edit = useDealAction(deal?.id ?? '');
  const mutation = deal ? edit : create;

  const initial: FormValues = deal
    ? {
        contactId: deal.contact.id,
        title: deal.title,
        amount: minorToDecimalString(deal.amountMinor, deal.currency),
        currency: deal.currency,
        stageId: deal.stage.id,
        expectedCloseOn: deal.expectedCloseOn ?? '',
        nextStep: deal.nextStep ?? '',
        nextStepLocal: deal.nextStepAt ? utcIsoToZonedLocal(deal.nextStepAt, timeZone) : '',
      }
    : {
        contactId: contact?.id ?? '',
        title: '',
        amount: '',
        currency: isCurrency(agencyCurrency) ? agencyCurrency : 'EGP',
        stageId: '',
        expectedCloseOn: '',
        nextStep: '',
        nextStepLocal: '',
      };
  const form = useForm<FormValues>({ defaultValues: initial, mode: 'onSubmit' });
  const { errors, dirtyFields } = form.formState;

  const close = () => {
    form.reset(initial);
    mutation.reset();
    onOpenChange(false);
  };

  const onSubmit = form.handleSubmit((v) => {
    let ok = true;
    if (!v.contactId) {
      form.setError('contactId', { message: 'Choose a lead.' });
      ok = false;
    }
    if (!v.title.trim()) {
      form.setError('title', { message: 'Give the deal a name.' });
      ok = false;
    }
    if (parseMoneyToMinor(v.amount, v.currency) === null) {
      form.setError('amount', {
        message: 'Use a positive number with at most 2 decimals, e.g. 12,500.50.',
      });
      ok = false;
    }
    if (!ok) return;
    const nextStepAt = v.nextStepLocal
      ? (zonedLocalToUtcIso(v.nextStepLocal, timeZone) ?? undefined)
      : undefined;
    const onError = (err: Error) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        for (const [key, messages] of Object.entries(err.fieldErrors)) {
          const field = key === 'nextStepAt' ? 'nextStepLocal' : key;
          form.setError(field as keyof FormValues, { message: messages[0] });
        }
      }
    };

    if (deal) {
      const body: DealUpdateInput = { version: deal.version };
      if (dirtyFields.title) body.title = v.title.trim();
      if (dirtyFields.amount || dirtyFields.currency) {
        body.amount = v.amount;
        body.currency = v.currency;
      }
      if (dirtyFields.expectedCloseOn) body.expectedCloseOn = v.expectedCloseOn || null;
      if (dirtyFields.nextStep) body.nextStep = v.nextStep.trim() || null;
      if (dirtyFields.nextStepLocal) body.nextStepAt = nextStepAt ?? null;
      edit.mutate(
        { kind: 'update', body },
        {
          onSuccess: () => {
            toast.success('Deal updated');
            close();
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      {
        contactId: v.contactId,
        title: v.title.trim(),
        amount: v.amount,
        currency: v.currency,
        ...(v.stageId ? { stageId: v.stageId } : {}),
        ...(v.expectedCloseOn ? { expectedCloseOn: v.expectedCloseOn } : {}),
        ...(v.nextStep.trim() ? { nextStep: v.nextStep.trim() } : {}),
        ...(nextStepAt ? { nextStepAt } : {}),
      },
      {
        onSuccess: (res) => {
          toast.success('Deal created', { description: res.data.title });
          close();
          navigate(`/app/deals/${res.data.id}`);
        },
        onError,
      },
    );
  });

  const error =
    mutation.error instanceof ApiError && mutation.error.code !== 'VALIDATION_FAILED'
      ? mutation.error
      : null;
  const contactId = useWatch({ control: form.control, name: 'contactId' });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : !mutation.isPending && close())}
      title={deal ? 'Edit deal' : 'New deal'}
      description={
        deal
          ? undefined
          : contact
            ? `For ${contact.fullName}`
            : 'Track an opportunity from first conversation to signature.'
      }
      className="sm:w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="deal-form"
            loading={mutation.isPending}
            loadingLabel="Saving…"
          >
            {deal ? 'Save changes' : 'Create deal'}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner
          tone={error.code === 'CONFLICT_STALE_VERSION' ? 'warning' : 'danger'}
          title="Not saved"
          className="mb-5"
        >
          {error.code === 'CONFLICT_STALE_VERSION'
            ? 'Someone else changed this deal while you were editing. Close this dialog to see their version, then edit again.'
            : error.message}
        </Banner>
      ) : null}
      <form
        id="deal-form"
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2"
      >
        {!deal && !contact ? (
          <ContactPicker
            value={contactId}
            onChange={(id) => form.setValue('contactId', id, { shouldDirty: true })}
            error={errors.contactId?.message}
          />
        ) : null}
        <Field label="Deal name" required error={errors.title?.message} className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Online ordering website"
              {...(contact || deal ? { 'data-autofocus': true } : {})}
              {...form.register('title')}
            />
          )}
        </Field>
        <Field
          label="Value"
          required
          hint="Exact amount, e.g. 12,500.50"
          error={errors.amount?.message}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              autoComplete="off"
              className="tabular"
              {...form.register('amount')}
            />
          )}
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
        {!deal ? (
          <Field label="Stage" hint="Defaults to the first stage.">
            {(p) => (
              <Select {...p} {...form.register('stageId')}>
                <option value="">{pipeline.data?.data.stages[0]?.name ?? 'First stage'}</option>
                {pipeline.data?.data.stages.slice(1).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Expected close" error={errors.expectedCloseOn?.message}>
          {(p) => <Input {...p} type="date" {...form.register('expectedCloseOn')} />}
        </Field>
        <Field
          label="Next step"
          hint="What has to happen next?"
          error={errors.nextStep?.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              maxLength={300}
              placeholder="e.g. Send revised scope"
              {...form.register('nextStep')}
            />
          )}
        </Field>
        <Field
          label="Next step due"
          hint={`${timeZone.replace('_', ' ')} time. Shows up in Follow-ups.`}
          error={errors.nextStepLocal?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} type="datetime-local" {...form.register('nextStepLocal')} />}
        </Field>
      </form>
    </Dialog>
  );
}
