import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { convertDealSchema, type ConvertDealInput } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { useConvertDeal, useDeliveryStaff } from './api';

/**
 * Hands a won deal to delivery (spec J3). One Idempotency-Key per opening of the dialog: if the
 * response is lost and the user presses Convert again, the server returns the same project.
 */
export function ConvertDealDialog({
  dealId,
  dealTitle,
  onClose,
}: {
  dealId: string;
  dealTitle: string;
  onClose: () => void;
}) {
  const { data: user } = useSession();
  const navigate = useNavigate();
  const [key] = useState(() => crypto.randomUUID());
  const staff = useDeliveryStaff();
  const convert = useConvertDeal(dealId);
  const managers = (staff.data?.data ?? []).filter((u) => u.role !== 'MEMBER');
  const form = useForm<ConvertDealInput>({
    resolver: zodResolver(convertDealSchema),
    defaultValues: {
      managerId: user?.role === 'PM' ? user.id : '',
      title: dealTitle,
      startOn: undefined,
      dueOn: undefined,
    },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;
  // The select can only show the default once its option exists, so re-apply it after loading.
  const loaded = staff.data !== undefined;
  useEffect(() => {
    if (loaded && user?.role === 'PM' && !form.getValues('managerId')) {
      form.setValue('managerId', user.id);
    } else if (loaded) {
      form.setValue('managerId', form.getValues('managerId'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const onSubmit = form.handleSubmit((v) =>
    convert.mutate(
      {
        key,
        input: {
          managerId: v.managerId,
          ...(v.title?.trim() ? { title: v.title.trim() } : {}),
          ...(v.startOn ? { startOn: v.startOn } : {}),
          ...(v.dueOn ? { dueOn: v.dueOn } : {}),
        },
      },
      {
        onSuccess: (res) => {
          toast.success(res.data.replayed ? 'This project already exists' : 'Project created');
          onClose();
          navigate(`/app/projects/${res.data.project.id}`);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            for (const [field, messages] of Object.entries(err.fieldErrors)) {
              form.setError(field as keyof ConvertDealInput, { message: messages[0] });
            }
          }
        },
      },
    ),
  );
  const error =
    convert.error instanceof ApiError && convert.error.code !== 'VALIDATION_FAILED'
      ? convert.error
      : null;
  const network =
    convert.error instanceof ApiError && ['NETWORK', 'TIMEOUT'].includes(convert.error.code);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !convert.isPending && onClose()}
      title="Convert to project"
      description="Creates the project with the client-accepted proposal as its scope baseline, milestones from the proposal and a handoff checklist."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={convert.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="convert-form"
            loading={convert.isPending}
            loadingLabel="Creating…"
          >
            {network ? 'Try again' : 'Create project'}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner
          tone={network ? 'warning' : 'danger'}
          title={network ? 'No answer from the server' : 'Not converted'}
          className="mb-5"
        >
          {network
            ? 'It is safe to try again: the same request cannot create a second project.'
            : error.message}
        </Banner>
      ) : null}
      <form id="convert-form" onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Project name"
          required
          error={errors.title?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} maxLength={200} {...form.register('title')} />}
        </Field>
        <Field
          label="Project manager"
          required
          error={errors.managerId?.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Select {...p} {...form.register('managerId')}>
              <option value="">Choose a manager…</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Start" error={errors.startOn?.message}>
          {(p) => (
            <Input
              {...p}
              type="date"
              {...form.register('startOn', { setValueAs: (v) => v || undefined })}
            />
          )}
        </Field>
        <Field label="Due" error={errors.dueOn?.message}>
          {(p) => (
            <Input
              {...p}
              type="date"
              {...form.register('dueOn', { setValueAs: (v) => v || undefined })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
