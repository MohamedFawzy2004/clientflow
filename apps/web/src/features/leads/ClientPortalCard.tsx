import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Globe } from 'lucide-react';
import { toast } from 'sonner';
import {
  clientOrgCreateSchema,
  portalInviteSchema,
  type ClientOrgDetail,
  type ContactWithDeals,
  type PortalInvitationCreated,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { Badge, Banner, Skeleton } from '../../components/ui/feedback';
import { Field, Input } from '../../components/ui/form';
import { useClientOrg, usePortalAction, useProposalPermissions } from '../proposals/api';

function message(err: unknown) {
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function SetupDialog({ lead, onClose }: { lead: ContactWithDeals; onClose: () => void }) {
  const action = usePortalAction();
  const form = useForm<{ name: string }>({
    resolver: zodResolver(clientOrgCreateSchema),
    defaultValues: { name: lead.companyName ?? lead.fullName },
  });
  const onSubmit = form.handleSubmit(({ name }) =>
    action.mutate(
      { kind: 'create-org', contactId: lead.id, name },
      {
        onSuccess: () => {
          toast.success('Client portal set up');
          onClose();
        },
      },
    ),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title="Set up the client portal"
      description="Proposals are shared with people you invite to this organization. They sign in to see only what you send them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="org-form" loading={action.isPending} loadingLabel="Saving…">
            Create organization
          </Button>
        </>
      }
    >
      {action.error ? (
        <Banner tone="danger" title="Not saved" className="mb-5">
          {message(action.error)}
        </Banner>
      ) : null}
      <form id="org-form" onSubmit={onSubmit} noValidate>
        <Field label="Organization name" required error={form.formState.errors.name?.message}>
          {(p) => <Input {...p} maxLength={200} data-autofocus {...form.register('name')} />}
        </Field>
      </form>
    </Dialog>
  );
}

function InviteDialog({ org, onClose }: { org: ClientOrgDetail; onClose: () => void }) {
  const action = usePortalAction();
  const [created, setCreated] = useState<PortalInvitationCreated | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(portalInviteSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const onSubmit = form.handleSubmit(({ email }) =>
    action.mutate(
      { kind: 'invite', orgId: org.id, email },
      { onSuccess: (res) => setCreated((res as { data: PortalInvitationCreated }).data) },
    ),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title={created ? 'Invitation created' : `Invite someone at ${org.name}`}
      description={
        created
          ? undefined
          : 'They get a one-time link valid for 7 days. They will only see proposals you send to this organization.'
      }
      footer={
        created ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="portal-invite-form"
              loading={action.isPending}
              loadingLabel="Inviting…"
            >
              Send invitation
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            {created.emailDelivery === 'sent_to_dev_sink'
              ? 'Email delivery is in development mode, so share this link yourself. It is shown only once.'
              : 'Share this link with them. It is shown only once.'}
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={created.acceptUrl}
              aria-label="Invitation link"
              className="font-mono text-xs"
            />
            <Button
              variant="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(created.acceptUrl)
                  .then(() => toast.success('Link copied'))
                  .catch(() => toast.error('Copy failed: select the link and copy it'))
              }
            >
              <Copy aria-hidden className="size-4" /> Copy
            </Button>
          </div>
        </div>
      ) : (
        <>
          {action.error ? (
            <Banner tone="danger" title="Not invited" className="mb-5">
              {message(action.error)}
            </Banner>
          ) : null}
          <form id="portal-invite-form" onSubmit={onSubmit} noValidate>
            <Field label="Email" required error={form.formState.errors.email?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="off"
                  data-autofocus
                  {...form.register('email')}
                />
              )}
            </Field>
          </form>
        </>
      )}
    </Dialog>
  );
}

/** Portal access for the customer organization this contact belongs to (managers only). */
export function ClientPortalCard({ lead }: { lead: ContactWithDeals }) {
  const { managePortal } = useProposalPermissions();
  const org = useClientOrg(lead.clientOrg?.id ?? null);
  const action = usePortalAction();
  const [dialog, setDialog] = useState<'setup' | 'invite' | null>(null);
  const [removing, setRemoving] = useState<ClientOrgDetail['portalUsers'][number] | null>(null);
  if (!managePortal) return null;

  const body = !lead.clientOrg ? (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-sm text-muted">
        Set up a portal so people at this client can review and accept proposals.
      </p>
      <Button variant="secondary" onClick={() => setDialog('setup')} disabled={!!lead.archivedAt}>
        <Globe aria-hidden className="size-4" /> Set up client portal
      </Button>
    </div>
  ) : org.isPending ? (
    <div className="py-4">
      <Skeleton className="h-10" />
    </div>
  ) : org.isError ? (
    <p className="py-4 text-sm text-danger">{message(org.error)}</p>
  ) : (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm text-text">
        <span className="font-medium">{org.data.data.name}</span>
      </p>
      {org.data.data.portalUsers.length === 0 && org.data.data.invitations.length === 0 ? (
        <p className="text-sm text-muted">Nobody is invited yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {org.data.data.portalUsers.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-text">{u.name}</span>
                <span className="block truncate text-xs text-muted">{u.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {u.active ? <Badge tone="success">Active</Badge> : <Badge>Removed</Badge>}
                {u.active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setRemoving(u)}
                  >
                    Remove<span className="sr-only"> {u.name}</span>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
          {org.data.data.invitations
            .filter((i) => i.status === 'PENDING')
            .map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-muted">{i.email}</span>
                <Badge tone="warning">Invited · until {formatDate(i.expiresAt)}</Badge>
              </li>
            ))}
        </ul>
      )}
      <div>
        <Button variant="secondary" size="sm" onClick={() => setDialog('invite')}>
          Invite to portal
        </Button>
      </div>
    </div>
  );

  return (
    <section
      aria-label="Client portal"
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border px-4 py-3 md:px-5">
        <h2 className="text-[15px] font-semibold text-text">Client portal</h2>
      </div>
      <div className="px-4 md:px-5">{body}</div>
      {dialog === 'setup' ? <SetupDialog lead={lead} onClose={() => setDialog(null)} /> : null}
      {dialog === 'invite' && org.data ? (
        <InviteDialog org={org.data.data} onClose={() => setDialog(null)} />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ''} from the portal?`}
        description="They are signed out at once and can no longer see or accept proposals."
        confirmLabel="Remove access"
        pendingLabel="Removing…"
        pending={action.isPending}
        error={action.error ? message(action.error) : null}
        onConfirm={() =>
          removing &&
          org.data &&
          action.mutate(
            {
              kind: 'deactivate',
              orgId: org.data.data.id,
              userId: removing.id,
              version: removing.version,
            },
            {
              onSuccess: () => {
                toast.success('Portal access removed');
                setRemoving(null);
              },
            },
          )
        }
      />
    </section>
  );
}
