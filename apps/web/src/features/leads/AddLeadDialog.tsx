import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONTACT_SOURCE_LABELS,
  CONTACT_SOURCES,
  contactCreateSchema,
  NOTES_MAX_LENGTH,
  type ContactCreateInput,
  zonedLocalToUtcIso,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { DEFAULT_TIMEZONE } from '../../lib/format';
import { useCreateLead } from './api';

// The browser's datetime-local input has no offset, so the form keeps a local value and
// converts it to an ISO timestamp on submit. Every other rule comes from the shared contract.
const formSchema = contactCreateSchema.omit({ nextActionAt: true, lifecycle: true }).extend({
  nextActionLocal: z
    .string()
    .optional()
    .refine((v) => !v || zonedLocalToUtcIso(v, 'UTC') !== null, {
      message: 'Enter a valid date and time.',
    }),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const FORM_FIELDS = [
  'fullName',
  'email',
  'phone',
  'companyName',
  'source',
  'notes',
  'nextActionLocal',
] as const;
const EMPTY: FormInput = {
  fullName: '',
  email: '',
  phone: '',
  companyName: '',
  source: undefined,
  nextActionLocal: '',
  notes: '',
};

/** The picked wall time means that time in the agency timezone, not the device timezone. */
function toPayload(values: FormOutput, timeZone: string): ContactCreateInput {
  const { nextActionLocal, ...rest } = values;
  const nextActionAt = nextActionLocal ? zonedLocalToUtcIso(nextActionLocal, timeZone) : null;
  return { ...rest, ...(nextActionAt ? { nextActionAt } : {}) };
}

export function AddLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreateLead();
  const timeZone = useSession().data?.agency.timezone ?? DEFAULT_TIMEZONE;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY,
    // Validate on submit, then live: blur validation shifts the layout under the pointer.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors, isDirty } = form.formState;
  const notesLength = useWatch({ control: form.control, name: 'notes' })?.length ?? 0;

  const close = () => {
    form.reset(EMPTY);
    create.reset();
    setConfirmDiscard(false);
    onOpenChange(false);
  };

  // Unsaved-changes guard (spec §7.4.8): a dirty form asks before it is discarded.
  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (isDirty && !create.isPending) return setConfirmDiscard(true);
    close();
  };

  const onSubmit = form.handleSubmit((values) => {
    create.mutate(toPayload(values, timeZone), {
      onSuccess: (res) => {
        const duplicates = res.meta.possibleDuplicates;
        close();
        if (duplicates.length > 0) {
          toast.warning('Lead added. Possible duplicate found', {
            description: `${duplicates.map((d) => d.fullName).join(', ')} has the same ${duplicates[0]!.matchedOn.join(' and ')}. Review before following up.`,
            duration: 10_000,
          });
        } else {
          toast.success('Lead added', {
            description: `${res.data.fullName} is saved and assigned to you.`,
          });
        }
        navigate(`/app/leads/${res.data.id}`);
      },
      onError: (err) => {
        // Server-side field errors are shown next to the matching inputs. Input is never lost.
        if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
          for (const [key, messages] of Object.entries(err.fieldErrors)) {
            const field = key === 'nextActionAt' ? 'nextActionLocal' : key;
            if ((FORM_FIELDS as readonly string[]).includes(field)) {
              form.setError(field as (typeof FORM_FIELDS)[number], { message: messages[0] });
            }
          }
        }
      },
    });
  });

  const serverError =
    create.error instanceof ApiError && create.error.code !== 'VALIDATION_FAILED'
      ? create.error
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={requestClose}
      title="Add lead"
      description="Capture who they are and the next step. You can add more detail later."
      footer={
        confirmDiscard ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={close}>
              Discard lead
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => requestClose(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-lead-form"
              loading={create.isPending}
              loadingLabel="Saving…"
            >
              Save lead
            </Button>
          </>
        )
      }
    >
      {confirmDiscard ? (
        <Banner tone="warning" title="Discard this lead?" className="mb-5">
          What you typed has not been saved.
        </Banner>
      ) : null}
      {serverError ? (
        <Banner
          tone="danger"
          className="mb-5"
          title={
            serverError.code === 'NETWORK' || serverError.code === 'TIMEOUT'
              ? 'Not saved: connection problem'
              : 'Not saved'
          }
        >
          {serverError.message} Your input is still here. Try again when ready.
          {serverError.requestId ? (
            <span className="mt-1 block text-xs text-muted">
              Reference: {serverError.requestId}
            </span>
          ) : null}
        </Banner>
      ) : null}

      <form
        id="add-lead-form"
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
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              data-autofocus
              placeholder="e.g. Salma Ibrahim"
              {...form.register('fullName')}
            />
          )}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(p) => (
            <Input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="off"
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+20 100 000 0000"
              {...form.register('phone')}
            />
          )}
        </Field>
        <Field label="Company" error={errors.companyName?.message}>
          {(p) => <Input {...p} autoComplete="off" {...form.register('companyName')} />}
        </Field>
        <Field label="Source" error={errors.source?.message}>
          {(p) => (
            <Select
              {...p}
              {...form.register('source', { setValueAs: (v) => (v === '' ? undefined : v) })}
            >
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
          hint={`When should someone get back to them? Times are in ${timeZone.replace('_', ' ')} time.`}
          error={errors.nextActionLocal?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} type="datetime-local" {...form.register('nextActionLocal')} />}
        </Field>
        <Field
          label="Notes"
          hint={`${notesLength.toLocaleString()} / ${NOTES_MAX_LENGTH.toLocaleString()} characters. Internal only, never shown to clients.`}
          error={errors.notes?.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              maxLength={NOTES_MAX_LENGTH + 100}
              {...form.register('notes')}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
