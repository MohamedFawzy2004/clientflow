import { useState } from 'react';
import { MailPlus, ShieldAlert, UserPlus, Users } from 'lucide-react';
import {
  can,
  ROLE_LABELS,
  type InvitationCreated,
  type InvitationSummary,
  type TeamMember,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, relativeDay } from '../../lib/format';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { useInvitationAction, useInvitations, useMembers } from './api';
import { InvitationLinkNotice, InviteDialog } from './InviteDialog';
import { ManageMemberDialog, manageBlockReason } from './ManageMemberDialog';

function StatusBadge({ status }: { status: TeamMember['status'] }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success">Active</Badge>
  ) : (
    <Badge tone="neutral">Deactivated</Badge>
  );
}

const INVITE_TONES = {
  PENDING: 'info',
  ACCEPTED: 'success',
  EXPIRED: 'warning',
  REVOKED: 'neutral',
} as const;
const INVITE_LABELS = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
} as const;

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5">
        <h2 className="text-[15px] font-semibold text-text">
          {title}
          {count !== undefined ? (
            <span className="ml-2 font-normal text-muted tabular">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MembersSection({
  timeZone,
  onManage,
}: {
  timeZone: string;
  onManage: (m: TeamMember) => void;
}) {
  const { data: user } = useSession();
  const members = useMembers();
  if (members.isPending) {
    return (
      <Section title="Members">
        <div className="flex flex-col gap-3 p-5" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </Section>
    );
  }
  if (members.isError) {
    const err = members.error instanceof ApiError ? members.error : null;
    return (
      <Section title="Members">
        <ErrorState
          message={members.error.message}
          requestId={err?.requestId}
          onRetry={() => members.refetch()}
          retrying={members.isFetching}
        />
      </Section>
    );
  }
  const rows = members.data.data;
  const lastSeen = (m: TeamMember) =>
    m.lastLoginAt ? formatDateTime(m.lastLoginAt, timeZone) : 'Never signed in';
  const manageLabel = (m: TeamMember) =>
    user && manageBlockReason(user.role, m) ? 'View' : 'Manage';

  return (
    <Section title="Members" count={rows.length}>
      <table className="hidden w-full table-fixed border-collapse text-left md:table">
        <caption className="sr-only">Team members</caption>
        <thead>
          <tr className="border-b border-border bg-surface-alt/60 text-xs font-semibold text-muted">
            <th scope="col" className="w-[36%] px-5 py-3 font-semibold">
              Member
            </th>
            <th scope="col" className="w-[16%] px-3 py-3 font-semibold">
              Role
            </th>
            <th scope="col" className="w-[14%] px-3 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="w-[22%] px-3 py-3 font-semibold">
              Last sign-in
            </th>
            <th scope="col" className="w-[12%] px-5 py-3 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium text-text">
                      <span className="truncate">{m.name}</span>
                      {m.isSelf ? <Badge tone="primary">You</Badge> : null}
                    </p>
                    <p className="truncate text-[13px] text-muted">{m.email}</p>
                  </div>
                </div>
              </td>
              <td className="truncate px-3 py-3 text-text">{ROLE_LABELS[m.role]}</td>
              <td className="px-3 py-3">
                <StatusBadge status={m.status} />
              </td>
              <td className="truncate px-3 py-3 text-muted tabular">{lastSeen(m)}</td>
              <td className="px-5 py-3 text-right">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onManage(m)}
                  aria-label={`${manageLabel(m)} ${m.name}`}
                >
                  {manageLabel(m)}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden" aria-label="Team members">
        {rows.map((m) => (
          <li
            key={m.id}
            className="flex items-start gap-3 border-b border-border px-4 py-4 last:border-0"
          >
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                <span className="break-words">{m.name}</span>
                {m.isSelf ? <Badge tone="primary">You</Badge> : null}
              </p>
              <p className="truncate text-[13px] text-muted">{m.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-text">
                <span>{ROLE_LABELS[m.role]}</span>
                <StatusBadge status={m.status} />
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onManage(m)}
              aria-label={`${manageLabel(m)} ${m.name}`}
            >
              {manageLabel(m)}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function InvitationsSection({ timeZone, onInvite }: { timeZone: string; onInvite: () => void }) {
  const invitations = useInvitations();
  const action = useInvitationAction();
  const [revoking, setRevoking] = useState<InvitationSummary | null>(null);
  const [resent, setResent] = useState<InvitationCreated | null>(null);

  if (invitations.isPending) {
    return (
      <Section title="Invitations">
        <div className="p-5" aria-hidden>
          <Skeleton className="h-10" />
        </div>
      </Section>
    );
  }
  if (invitations.isError) {
    return (
      <Section title="Invitations">
        <ErrorState
          message={invitations.error.message}
          onRetry={() => invitations.refetch()}
          retrying={invitations.isFetching}
        />
      </Section>
    );
  }
  const rows = invitations.data.data;
  const pending = rows.filter((r) => r.status === 'PENDING').length;

  const resend = (inv: InvitationSummary) =>
    action.mutate(
      { id: inv.id, action: 'resend' },
      {
        onSuccess: (res) => setResent(res.data as InvitationCreated),
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <Section title="Invitations" count={`${pending} pending`}>
      {rows.length === 0 ? (
        <EmptyState
          icon={<MailPlus aria-hidden className="size-5" />}
          title="No invitations yet"
          description="Invite teammates to give them their own sign-in. Links expire after 7 days."
          action={
            <Button onClick={onInvite}>
              <UserPlus aria-hidden className="size-4" />
              Invite member
            </Button>
          }
        />
      ) : (
        <ul>
          {rows.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-col gap-3 border-b border-border px-4 py-3.5 last:border-0 sm:flex-row sm:items-center md:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-text">{inv.email}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {ROLE_LABELS[inv.role]} · invited by {inv.invitedBy.name} on{' '}
                  {formatDate(inv.createdAt, timeZone)}
                  {inv.status === 'PENDING'
                    ? ` · expires ${relativeDay(inv.expiresAt, new Date(), timeZone)}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={INVITE_TONES[inv.status]}>{INVITE_LABELS[inv.status]}</Badge>
                {inv.status !== 'ACCEPTED' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => resend(inv)}
                    disabled={action.isPending}
                    aria-label={`Resend invitation to ${inv.email}`}
                  >
                    Resend
                  </Button>
                ) : null}
                {inv.status === 'PENDING' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setRevoking(inv)}
                    aria-label={`Revoke invitation to ${inv.email}`}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRevoking(null);
            action.reset();
          }
        }}
        title="Revoke invitation?"
        description={
          revoking ? `The link sent to ${revoking.email} stops working immediately.` : undefined
        }
        confirmLabel="Revoke invitation"
        pendingLabel="Revoking…"
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={() =>
          revoking &&
          action.mutate(
            { id: revoking.id, action: 'revoke' },
            {
              onSuccess: () => {
                toast.success('Invitation revoked');
                setRevoking(null);
              },
            },
          )
        }
      />

      <Dialog
        open={resent !== null}
        onOpenChange={(o) => !o && setResent(null)}
        title="New invitation link"
        footer={<Button onClick={() => setResent(null)}>Done</Button>}
      >
        {resent ? <InvitationLinkNotice created={resent} /> : null}
      </Dialog>
    </Section>
  );
}

export function TeamPage() {
  const { data: user } = useSession();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [managing, setManaging] = useState<TeamMember | null>(null);
  const members = useMembers();
  if (!user) return null;
  const timeZone = user.agency.timezone;

  if (
    !can(user.role, 'team.read') ||
    (members.error instanceof ApiError && members.error.status === 403)
  ) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Team management is for owners and admins"
        description="Ask your agency owner if you need to invite someone or change access."
      />
    );
  }

  // Keep the dialog in sync with refetched data (e.g. new version after an action elsewhere).
  const current = managing
    ? (members.data?.data.find((m) => m.id === managing.id) ?? managing)
    : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Team
          </h1>
          <p className="mt-1 text-sm text-muted">
            Who can sign in to {user.agency.name}, and what they can do.
          </p>
        </div>
        {can(user.role, 'team.invite') ? (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden className="size-4" />
            Invite member
          </Button>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <MembersSection timeZone={timeZone} onManage={setManaging} />
        <InvitationsSection timeZone={timeZone} onInvite={() => setInviteOpen(true)} />
        <p className="flex items-start gap-2 text-xs leading-[18px] text-muted">
          <Users aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Every change here is recorded in the security audit log. Deactivated members keep their
          records; they just cannot sign in.
        </p>
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ManageMemberDialog member={current} onOpenChange={(o) => !o && setManaging(null)} />
    </>
  );
}
