import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useBlocker } from 'react-router';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeProposalTotals,
  formatBp,
  formatMoney,
  minorToDecimalString,
  parseMoneyToMinor,
  parsePercentToBp,
  parseQuantityToCenti,
  proposalDraftUpdateSchema,
  type ProposalDetail,
  type ProposalDraftUpdateInput,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Card, TotalsBreakdown } from '../../components/proposals/proposal-ui';
import { useProposalAction, useServices } from './api';

const formSchema = proposalDraftUpdateSchema.omit({ version: true });
type FormValues = Omit<ProposalDraftUpdateInput, 'version'>;
type ItemValues = FormValues['items'][number];

function toFormValues(p: ProposalDetail): FormValues {
  const v = p.current;
  return {
    title: v.title,
    summary: v.summary ?? '',
    inclusions: v.inclusions ?? '',
    exclusions: v.exclusions ?? '',
    assumptions: v.assumptions ?? '',
    milestones: v.milestones ?? '',
    paymentTerms: v.paymentTerms ?? '',
    terms: v.terms ?? '',
    internalNotes: v.internalNotes ?? '',
    expiresOn: v.expiresOn,
    discountPercent: formatBp(v.discountBp),
    taxRatePercent: formatBp(v.taxRateBp),
    taxLabel: v.taxLabel,
    items: v.items.map((i) => ({
      serviceId: i.serviceId,
      name: i.name,
      description: i.description ?? '',
      unit: i.unit,
      quantity: i.quantity,
      unitPrice: minorToDecimalString(i.unitPriceMinor, v.currency),
    })),
  };
}

/** Editable copy of a DRAFT version. The server recomputes every total on save (FR-Q03). */
export function ProposalEditor({ proposal }: { proposal: ProposalDetail }) {
  const currency = proposal.current.currency;
  const action = useProposalAction(proposal.id);
  const services = useServices();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(proposal),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const { errors, isDirty } = form.formState;

  // Re-sync after a save or a refresh from the server, unless the user is mid-edit.
  const version = proposal.current.version;
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toFormValues(proposal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Unsaved-changes guard: in-app navigation and closing the tab (spec §7.5 editor rule).
  const blocker = useBlocker(isDirty && !action.isPending);
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const watched = useWatch({ control: form.control });
  const preview = useMemo(() => {
    const lines = (watched.items ?? []).map((i) => ({
      quantityCenti: parseQuantityToCenti(i?.quantity ?? ''),
      unitPriceMinor: parseMoneyToMinor(i?.unitPrice ?? '', currency),
    }));
    const discountBp = parsePercentToBp(watched.discountPercent ?? '');
    const taxRateBp = parsePercentToBp(watched.taxRatePercent ?? '');
    if (
      discountBp === null ||
      taxRateBp === null ||
      lines.some((l) => l.quantityCenti === null || l.unitPriceMinor === null)
    ) {
      return null;
    }
    const totals = computeProposalTotals({
      items: lines.map((l) => ({
        quantityCenti: l.quantityCenti!,
        unitPriceMinor: l.unitPriceMinor!,
      })),
      discountBp,
      taxRateBp,
    });
    return { totals, discountBp, taxRateBp };
  }, [watched, currency]);

  const onSubmit = form.handleSubmit((values) =>
    action.mutate(
      { kind: 'draft', body: { ...values, version } },
      {
        onSuccess: (res) => {
          form.reset(toFormValues(res.data));
          toast.success('Draft saved');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
            for (const [field, messages] of Object.entries(err.fieldErrors)) {
              form.setError(field as keyof FormValues, { message: messages[0] });
            }
          }
        },
      },
    ),
  );

  const addService = (serviceId: string) => {
    const s = services.data?.data.find((x) => x.id === serviceId);
    if (!s) return;
    items.append({
      serviceId: s.id,
      name: s.name,
      description: s.description ?? '',
      unit: s.unit,
      quantity: '1',
      unitPrice: minorToDecimalString(s.rateMinor, s.currency),
    });
  };
  const addCustom = () =>
    items.append({
      serviceId: null,
      name: '',
      description: '',
      unit: 'hour',
      quantity: '1',
      unitPrice: '',
    });

  const saveError =
    action.error instanceof ApiError && action.error.code !== 'VALIDATION_FAILED'
      ? action.error
      : null;
  const itemError = (i: number, f: keyof ItemValues) =>
    (errors.items?.[i]?.[f] as { message?: string } | undefined)?.message;
  const usable = (services.data?.data ?? []).filter((s) => s.currency === currency);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-label="Edit draft">
      {saveError ? (
        <Banner
          tone={saveError.code === 'CONFLICT_STALE_VERSION' ? 'warning' : 'danger'}
          title="Not saved"
        >
          {saveError.code === 'CONFLICT_STALE_VERSION'
            ? 'Someone else changed this draft. Reload the page to see their version; your edits are still here until you leave.'
            : saveError.message}
        </Banner>
      ) : null}

      <Card title="Scope">
        <div className="grid gap-5">
          <Field label="Title" required error={errors.title?.message}>
            {(p) => <Input {...p} maxLength={200} {...form.register('title')} />}
          </Field>
          <Field
            label="Summary"
            hint="What the client gets, in a few sentences."
            error={errors.summary?.message}
          >
            {(p) => <Textarea {...p} rows={3} maxLength={5000} {...form.register('summary')} />}
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Included" hint="One item per line." error={errors.inclusions?.message}>
              {(p) => (
                <Textarea {...p} rows={4} maxLength={5000} {...form.register('inclusions')} />
              )}
            </Field>
            <Field
              label="Not included"
              hint="Say clearly what is out of scope."
              error={errors.exclusions?.message}
            >
              {(p) => (
                <Textarea {...p} rows={4} maxLength={5000} {...form.register('exclusions')} />
              )}
            </Field>
            <Field label="Assumptions" error={errors.assumptions?.message}>
              {(p) => (
                <Textarea {...p} rows={3} maxLength={5000} {...form.register('assumptions')} />
              )}
            </Field>
            <Field label="Milestones" error={errors.milestones?.message}>
              {(p) => (
                <Textarea {...p} rows={3} maxLength={5000} {...form.register('milestones')} />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Card title={`Price (${currency})`}>
        {items.fields.length === 0 ? (
          <p className="text-sm text-muted">
            No lines yet. Add a service from the catalog or a custom line.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {items.fields.map((f, i) => (
              <li key={f.id} className="rounded-md border border-border p-3 md:p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                  <Field label={`Line ${i + 1}`} required error={itemError(i, 'name')}>
                    {(p) => <Input {...p} maxLength={200} {...form.register(`items.${i}.name`)} />}
                  </Field>
                  <Field label="Quantity" required error={itemError(i, 'quantity')}>
                    {(p) => (
                      <Input {...p} inputMode="decimal" {...form.register(`items.${i}.quantity`)} />
                    )}
                  </Field>
                  <Field label="Unit" required error={itemError(i, 'unit')}>
                    {(p) => <Input {...p} maxLength={40} {...form.register(`items.${i}.unit`)} />}
                  </Field>
                  <Field
                    label={`Unit price (${currency})`}
                    required
                    error={itemError(i, 'unitPrice')}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="decimal"
                        {...form.register(`items.${i}.unitPrice`)}
                      />
                    )}
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-muted">
                    Amount:{' '}
                    <span className="tabular font-medium text-text">
                      {preview
                        ? formatMoney(preview.totals.lineTotalsMinor[i] ?? '0', currency)
                        : '—'}
                    </span>
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move line ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => items.move(i, i - 1)}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move line ${i + 1} down`}
                      disabled={i === items.fields.length - 1}
                      onClick={() => items.move(i, i + 1)}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => items.remove(i)}
                    >
                      <Trash2 aria-hidden className="size-4" /> Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {errors.items?.message || errors.items?.root?.message ? (
          <p className="mt-3 text-xs font-medium text-danger">
            {errors.items?.message ?? errors.items?.root?.message}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="add-service" className="text-[13px] font-medium text-text">
              Add from catalog
            </label>
            <Select
              id="add-service"
              className="mt-1.5"
              value=""
              disabled={usable.length === 0}
              onChange={(e) => addService(e.target.value)}
            >
              <option value="">
                {usable.length === 0
                  ? `No ${currency} services in the catalog`
                  : 'Choose a service…'}
              </option>
              {usable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatMoney(s.rateMinor, s.currency)} per {s.unit}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="secondary" onClick={addCustom}>
            <Plus aria-hidden className="size-4" /> Custom line
          </Button>
        </div>

        <div className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
          <Field label="Discount %" required error={errors.discountPercent?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...form.register('discountPercent')} />}
          </Field>
          <Field
            label="Tax %"
            required
            hint="Egypt VAT is 14%."
            error={errors.taxRatePercent?.message}
          >
            {(p) => <Input {...p} inputMode="decimal" {...form.register('taxRatePercent')} />}
          </Field>
          <Field label="Tax name" required error={errors.taxLabel?.message}>
            {(p) => <Input {...p} maxLength={40} {...form.register('taxLabel')} />}
          </Field>
        </div>
        <div className="mt-5" aria-live="polite">
          {preview ? (
            <TotalsBreakdown
              currency={currency}
              subtotalMinor={preview.totals.subtotalMinor}
              discountMinor={preview.totals.discountMinor}
              discountBp={preview.discountBp}
              taxMinor={preview.totals.taxMinor}
              taxRateBp={preview.taxRateBp}
              taxLabel={watched.taxLabel || 'Tax'}
              totalMinor={preview.totals.totalMinor}
              preview
            />
          ) : (
            <p className="text-right text-sm text-muted">
              Fix the highlighted values to see the total.
            </p>
          )}
        </div>
      </Card>

      <Card title="Terms">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Payment terms" error={errors.paymentTerms?.message}>
            {(p) => (
              <Textarea {...p} rows={3} maxLength={2000} {...form.register('paymentTerms')} />
            )}
          </Field>
          <Field label="Valid until" required error={errors.expiresOn?.message}>
            {(p) => <Input {...p} type="date" {...form.register('expiresOn')} />}
          </Field>
          <Field label="Terms" className="md:col-span-2" error={errors.terms?.message}>
            {(p) => <Textarea {...p} rows={5} maxLength={10000} {...form.register('terms')} />}
          </Field>
          <Field
            label="Internal notes"
            className="md:col-span-2"
            hint="Only your team sees these. They never appear in the client portal or the printed proposal."
            error={errors.internalNotes?.message}
          >
            {(p) => (
              <Textarea {...p} rows={3} maxLength={5000} {...form.register('internalNotes')} />
            )}
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-lg md:border md:px-5">
        <p className="mr-auto text-[13px] text-muted" aria-live="polite">
          {isDirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
        <Button type="submit" loading={action.isPending} loadingLabel="Saving…" disabled={!isDirty}>
          Save draft
        </Button>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave without saving?"
        description="Your changes to this draft will be lost."
        confirmLabel="Discard changes"
        pendingLabel="Leaving…"
        pending={false}
        onConfirm={() => blocker.proceed?.()}
      />
    </form>
  );
}
