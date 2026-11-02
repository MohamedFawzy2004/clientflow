import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, WEEKDAYS, type AgencySettings, type Currency } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { useAgencySettings, useUpdateAgency } from '../dashboard/api';

interface FormValues {
  name: string;
  contactEmail: string;
  phone: string;
  address: string;
  defaultCurrency: Currency;
  timeZone: string;
  workingDays: number[];
}

const toForm = (s: AgencySettings): FormValues => ({
  name: s.name,
  contactEmail: s.contactEmail ?? '',
  phone: s.phone ?? '',
  address: s.address ?? '',
  defaultCurrency: s.defaultCurrency,
  timeZone: s.timeZone,
  workingDays: s.workingDays,
});

/** Agency profile (FR-I09). The server validates every value again. */
export function SettingsPage() {
  const query = useAgencySettings();
  const update = useUpdateAgency();
  const form = useForm<FormValues>({ mode: 'onSubmit', reValidateMode: 'onChange' });
  const { errors, isDirty } = form.formState;
  const days = useWatch({ control: form.control, name: 'workingDays' }) ?? [];
  const settings = query.data?.data;

  useEffect(() => {
    if (settings && !form.formState.isDirty) form.reset(toForm(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.version]);

  const error = query.error instanceof ApiError ? query.error : null;
  if (error?.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Agency settings are for owners and admins"
      />
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (!settings) return <Skeleton className="h-96 rounded-lg" />;

  const onSubmit = form.handleSubmit((v) =>
    update.mutate(
      { ...v, version: settings.version },
      {
        onSuccess: (res) => {
          form.reset(toForm(res.data));
          toast.success('Settings saved');
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            for (const [field, messages] of Object.entries(err.fieldErrors)) {
              form.setError(field as keyof FormValues, { message: messages[0] });
            }
          }
        },
      },
    ),
  );
  const saveError =
    update.error instanceof ApiError && update.error.code !== 'VALIDATION_FAILED'
      ? update.error
      : null;
  const toggleDay = (d: number) => {
    const next = days.includes(d)
      ? days.filter((x) => x !== d)
      : [...days, d].sort((a, b) => a - b);
    form.setValue('workingDays', next, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Agency settings
      </h1>
      <p className="mt-1 text-sm text-muted">Shown on proposals, PDFs and in the client portal.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex max-w-3xl flex-col gap-6">
        {saveError ? (
          <Banner
            tone={saveError.code === 'CONFLICT_STALE_VERSION' ? 'warning' : 'danger'}
            title="Not saved"
          >
            {saveError.code === 'CONFLICT_STALE_VERSION'
              ? 'Someone else changed these settings. Reload to see their version.'
              : saveError.message}
          </Banner>
        ) : null}
        <Card title="Profile">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Agency name"
              required
              error={errors.name?.message}
              className="sm:col-span-2"
            >
              {(p) => (
                <Input
                  {...p}
                  maxLength={200}
                  {...form.register('name', { required: 'Enter the agency name.' })}
                />
              )}
            </Field>
            <Field label="Contact email" error={errors.contactEmail?.message}>
              {(p) => (
                <Input {...p} type="email" maxLength={254} {...form.register('contactEmail')} />
              )}
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              {(p) => <Input {...p} maxLength={40} {...form.register('phone')} />}
            </Field>
            <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={2} maxLength={500} {...form.register('address')} />}
            </Field>
          </div>
        </Card>
        <Card title="Defaults">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Default currency"
              required
              hint="Used for new deals and services. Existing amounts keep their currency."
              error={errors.defaultCurrency?.message}
            >
              {(p) => (
                <Select {...p} {...form.register('defaultCurrency')}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Time zone"
              required
              hint="Decides when “today” starts for follow-ups and proposal expiry."
              error={errors.timeZone?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  maxLength={64}
                  {...form.register('timeZone', { required: 'Enter a time zone.' })}
                />
              )}
            </Field>
          </div>
          <fieldset className="mt-5">
            <legend className="text-[13px] font-medium text-text">Working days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((label, d) => (
                <label
                  key={label}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong px-3 text-sm text-text has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={days.includes(d)}
                    onChange={() => toggleDay(d)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors.workingDays?.message ? (
              <p className="mt-1.5 text-xs font-medium text-danger">{errors.workingDays.message}</p>
            ) : null}
          </fieldset>
        </Card>
        <div className="flex items-center justify-end gap-3">
          <p className="mr-auto text-[13px] text-muted">
            {isDirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
          <Button
            type="submit"
            loading={update.isPending}
            loadingLabel="Saving…"
            disabled={!isDirty}
          >
            Save settings
          </Button>
        </div>
      </form>
    </>
  );
}
