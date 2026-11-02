import { useState } from 'react';
import {
  can,
  grantableRoles,
  ROLE_LABELS,
  type StaffRole,
  type TeamMember,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Select } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { useMemberAction, type MemberAction } from './api';

type Step = 'overview' | 'confirm-deactivate' | 'confirm-signout';

/** Why the current user may not manage this member, or null. Mirrors the API rules (UI hint only). */
export function manageBlockReason(
  actorRole: TeamMember['role'],
  member: TeamMember,
): string | null {
  if (member.isSelf) return 'You cannot change your own account here.';
  if (member.role === 'OWNER' && !can(actorRole, 'team.manage_owners')) {
    return 'Only an owner can change another owner’s account.';
  }
  return null;
}

export function ManageMemberDialog({
  member,
  onOpenChange,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: user } = useSession();
  const action = useMemberAction();
  const [step, setStep] = useState<Step>('overview');
  const [role, setRole] = useState<StaffRole | null>(null);

  if (!member || !user) return null;
  const blocked = manageBlockReason(user.role, member);
  const roles = grantableRoles(user.role);
  const selectedRole = role ?? (member.role as StaffRole);

  const close = () => {
    action.reset();
    setStep('overview');
    setRole(null);
    onOpenChange(false);
  };

  const run = (a: MemberAction, success: string) =>
    action.mutate(
      { member, action: a },
      {
        onSuccess: () => {
          toast.success(success);
          close();
        },
        onError: () => setStep('overview'),
      },
    );

  const error = action.error instanceof ApiError ? action.error : null;
  const errorText =
    error?.code === 'CONFLICT_STALE_VERSION'
      ? 'This member was changed by someone else. The list is refreshed: review and try again.'
      : error?.message;

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (step === 'confirm-deactivate') {
    body = (
      <Banner tone="warning" title={`Deactivate ${member.name}?`}>
        They are signed out everywhere right away and cannot sign in until reactivated. Their
        records stay in the workspace.
      </Banner>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={() => setStep('overview')} disabled={action.isPending}>
          Back
        </Button>
        <Button
          variant="danger"
          data-autofocus
          loading={action.isPending}
          loadingLabel="Deactivating…"
          onClick={() => run({ kind: 'deactivate' }, `${member.name} was deactivated`)}
        >
          Deactivate
        </Button>
      </>
    );
  } else if (step === 'confirm-signout') {
    body = (
      <Banner tone="warning" title={`Sign ${member.name} out everywhere?`}>
        Their{' '}
        {member.activeSessions === 1
          ? 'active session ends'
          : `${member.activeSessions} active sessions end`}{' '}
        now. Their account and role stay the same.
      </Banner>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={() => setStep('overview')} disabled={action.isPending}>
          Back
        </Button>
        <Button
          variant="danger"
          data-autofocus
          loading={action.isPending}
          loadingLabel="Signing out…"
          onClick={() =>
            run({ kind: 'revoke-sessions' }, `${member.name} was signed out everywhere`)
          }
        >
          Sign out everywhere
        </Button>
      </>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar name={member.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{member.name}</p>
            <p className="truncate text-[13px] text-muted">{member.email}</p>
          </div>
        </div>
        {errorText ? (
          <Banner tone="danger" title="Not saved">
            {errorText}
          </Banner>
        ) : null}
        {blocked ? (
          <Banner tone="info" title="View only">
            {blocked}
          </Banner>
        ) : (
          <>
            <Field
              label="Role"
              required
              hint="Changing the role signs them out on every device, so new permissions apply at once."
            >
              {(p) => (
                <Select
                  {...p}
                  value={selectedRole}
                  onChange={(e) => setRole(e.target.value as StaffRole)}
                  disabled={member.status === 'DEACTIVATED'}
                  data-autofocus
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-col gap-2 border-t border-border pt-5">
              <p className="text-[13px] font-semibold text-text">Access</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {member.status === 'ACTIVE' ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setStep('confirm-signout')}
                      disabled={member.activeSessions === 0}
                      title={member.activeSessions === 0 ? 'No active sessions' : undefined}
                    >
                      Sign out everywhere
                    </Button>
                    <Button
                      variant="secondary"
                      className="text-danger"
                      onClick={() => setStep('confirm-deactivate')}
                    >
                      Deactivate
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    loading={action.isPending}
                    loadingLabel="Reactivating…"
                    onClick={() => run({ kind: 'reactivate' }, `${member.name} can sign in again`)}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={close} disabled={action.isPending}>
          Close
        </Button>
        {!blocked && member.status === 'ACTIVE' ? (
          <Button
            disabled={selectedRole === member.role}
            loading={action.isPending}
            loadingLabel="Saving…"
            onClick={() =>
              run(
                { kind: 'role', role: selectedRole },
                `${member.name} is now ${ROLE_LABELS[selectedRole]}`,
              )
            }
          >
            Save role
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && close()}
      title={step === 'overview' ? 'Manage member' : 'Please confirm'}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
