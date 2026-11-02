import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy } from 'lucide-react';
import {
  grantableRoles,
  invitationCreateSchema,
  ROLE_LABELS,
  type InvitationCreate,
  type InvitationCreated,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { useInvite } from './api';

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={url}
        aria-label="Invitation link"
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-[13px] md:text-[13px]"
      />
      <Button variant="secondary" size="lg" onClick={copy} aria-live="polite">
        {copied ? (
          <Check aria-hidden className="size-4 text-success" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function InvitationLinkNotice({ created }: { created: InvitationCreated }) {
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="success" title={`Invitation ready for ${created.invitation.email}`}>
        {created.emailDelivery === 'sent_to_dev_sink'
          ? 'Development mode: the email was written to the local mail sink, not sent. Share the link below.'
          : 'Email delivery is not configured yet. Share the link below with the person directly.'}
      </Banner>
      <CopyLink url={created.acceptUrl} />
      <p className="text-xs leading-[18px] text-muted">
        The link works once and expires in 7 days. It is shown only now: if it is lost, use
        <span className="font-medium text-text"> Resend </span>
        to create a new one.
      </p>
    </div>
  );
}

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: user } = useSession();
  const invite = useInvite();
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const roles = user ? grantableRoles(user.role) : [];
  const form = useForm<InvitationCreate>({
    resolver: zodResolver(invitationCreateSchema),
    defaultValues: { email: '', role: 'SALES' },
    // Validate on submit, then live: blur validation shifts the layout under the pointer.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;

  const close = () => {
    form.reset();
    invite.reset();
    setCreated(null);
    onOpenChange(false);
  };

  const onSubmit = form.handleSubmit((values) =>
    invite.mutate(values, {
      onSuccess: (res) => setCreated(res.data),
      onError: (err) => {
        if (err instanceof ApiError && err.fieldErrors.email) {
          form.setError('email', { message: err.fieldErrors.email[0] });
        }
      },
    }),
  );
  const error =
    invite.error instanceof ApiError && !invite.error.fieldErrors.email ? invite.error : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={created ? 'Invitation created' : 'Invite a team member'}
      description={
        created ? undefined : 'They choose their own name and password when they accept.'
      }
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={invite.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="invite-form"
              loading={invite.isPending}
              loadingLabel="Creating…"
            >
              Create invitation
            </Button>
          </>
        )
      }
    >
      {created ? (
        <InvitationLinkNotice created={created} />
      ) : (
        <>
          {error ? (
            <Banner tone="danger" title="Invitation not created" className="mb-5">
              {error.message}
            </Banner>
          ) : null}
          <form id="invite-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <Field label="Work email" required error={errors.email?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  data-autofocus
                  {...form.register('email')}
                />
              )}
            </Field>
            <Field
              label="Role"
              required
              hint="Roles decide what they can see. You can change it later."
              error={errors.role?.message}
            >
              {(p) => (
                <Select {...p} {...form.register('role')}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </form>
        </>
      )}
    </Dialog>
  );
}
