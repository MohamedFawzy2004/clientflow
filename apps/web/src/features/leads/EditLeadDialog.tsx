import { useForm } from 'react-hook-form';
import {
  CONTACT_SOURCE_LABELS,
  CONTACT_SOURCES,
  NOTES_MAX_LENGTH,
  utcIsoToZonedLocal,
  zonedLocalToUtcIso,
  type ContactDetail,
  type ContactSource,
  type ContactUpdateInput,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { useLeadAction } from './api';

interface FormValues {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  source: ContactSource | '';
  nextActionLocal: string;
  notes: string;
}

const FIELDS = ['fullName', 'email', 'phone', 'companyName', 'source', 'notes'] as const;

/** Edits send only changed fields plus the version the user loaded (409 if someone else saved). */
export function EditLeadDialog({
  lead,
  timeZone,
  open,
  onOpenChange,
}: {
  lead: ContactDetail;
  timeZone: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const action = useLeadAction(lead.id);
  const initial: FormValues = {
    fullName: lead.fullName,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    companyName: lead.companyName ?? '',
    source: lead.source ?? '',
    nextActionLocal: lead.nextActionAt ? utcIsoToZonedLocal(lead.nextActionAt, timeZone) : '',
    notes: lead.notes ?? '',
  };
  const form = useForm<FormValues>({ defaultValues: initial, values: initial, mode: 'onSubmit' });
  const { errors, isDirty, dirtyFields } = form.formState;

  const close = () => {
    form.reset(initial);
    action.reset();
    onOpenChange(false);
  };

  const onSubmit = form.handleSubmit((v) => {
    if (!v.fullName.trim()) {
      form.setError('fullName', { message: 'Enter the lead’s name.' });
      return;
    }
    const body: ContactUpdateInput = { version: lead.version };
    for (const k of FIELDS) {
      if (dirtyFields[k]) (body as Record<string, unknown>)[k] = v[k] === '' ? null : v[k];
    }
    if (dirtyFields.nextActionLocal) {
      body.nextActionAt = v.nextActionLocal
        ? zonedLocalToUtcIso(v.nextActionLocal, timeZone)
        : null;
    }
    action.mutate(
      { kind: 'update', body },
      {
        onSuccess: () => {
          toast.success('Lead updated');
          close();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
            for (const [key, messages] of Object.entries(err.fieldErrors)) {
              const field = key === 'nextActionAt' ? 'nextActionLocal' : key;
              form.setError(field as keyof FormValues, { message: messages[0] });
            }
          }
        },
      },
    );
  });

  const error =
    action.error instanceof ApiError && action.error.code !== 'VALIDATION_FAILED'
      ? action.error
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : !action.isPending && close())}
      title="Edit lead"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-lead-form"
            disabled={!isDirty}
            loading={action.isPending}
            loadingLabel="Saving…"
          >
            Save changes
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
            ? 'Someone else changed this lead while you were editing. Close this dialog to see their version, then edit again.'
            : error.message}
        </Banner>
      ) : null}
      <form
        id="edit-lead-form"
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2"
      >
        <Field
          label="Full name"
          required
          error={errors.fullName?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} data-autofocus {...form.register('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" inputMode="email" {...form.register('email')} />}
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          {(p) => <Input {...p} type="tel" inputMode="tel" {...form.register('phone')} />}
        </Field>
        <Field label="Company" error={errors.companyName?.message}>
          {(p) => <Input {...p} {...form.register('companyName')} />}
        </Field>
        <Field label="Source" error={errors.source?.message}>
          {(p) => (
            <Select {...p} {...form.register('source')}>
              <option value="">Not specified</option>
              {CONTACT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Next follow-up"
          hint={`Times are in ${timeZone.replace('_', ' ')} time. Clear the field to remove it.`}
          error={errors.nextActionLocal?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} type="datetime-local" {...form.register('nextActionLocal')} />}
        </Field>
        <Field
          label="Notes"
          hint="Internal only, never shown to clients."
          error={errors.notes?.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea {...p} rows={4} maxLength={NOTES_MAX_LENGTH} {...form.register('notes')} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
