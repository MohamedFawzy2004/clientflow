import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { GitPullRequestArrow, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Textarea } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { ChangeStatusBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useChangeAction, useChanges } from './api';

export function changeMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this request. It is refreshed: try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** The request itself: what should change and why (FR-S01). Shared with the portal. */
export function RequestChangeForm({
  id,
  onSubmit,
  error,
}: {
  id: string;
  onSubmit: (body: { title: string; description: string; justification: string | null }) => void;
  error: string | null;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [justification, setJustification] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || description.trim().length < 3) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      justification: justification.trim() || null,
    });
  };
  return (
    <form id={id} onSubmit={submit} noValidate className="flex flex-col gap-5">
      {error ? (
        <Banner tone="danger" title="Not sent">
          {error}
        </Banner>
      ) : null}
      <Field
        label="Title"
        required
        error={touched && !title.trim() ? 'Give it a name.' : undefined}
      >
        {(fp) => (
          <Input
            {...fp}
            data-autofocus
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="What should change"
        required
        error={
          touched && description.trim().length < 3 ? 'Describe what should change.' : undefined
        }
      >
        {(fp) => (
          <Textarea
            {...fp}
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Field label="Why" hint="The reason helps the team estimate the right thing.">
        {(fp) => (
          <Textarea
            {...fp}
            rows={2}
            maxLength={2000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        )}
      </Field>
    </form>
  );
}

function NewChangeDialog({ onClose }: { onClose: () => void }) {
  const p = useProjectContext();
  const navigate = useNavigate();
  const action = useChangeAction();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title="New change request"
      description="Record a change to the agreed scope. Nothing changes until the client accepts it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-change"
            loading={action.isPending}
            loadingLabel="Creating…"
          >
            Create
          </Button>
        </>
      }
    >
      <RequestChangeForm
        id="new-change"
        error={action.error ? changeMessage(action.error) : null}
        onSubmit={(body) =>
          action.mutate(
            { kind: 'create', projectId: p.id, body },
            {
              onSuccess: (res) => {
                toast.success('Change request created. Estimate it next.');
                onClose();
                navigate(`/app/projects/${p.id}/changes/${res.data.id}`);
              },
            },
          )
        }
      />
    </Dialog>
  );
}

/** Change requests of the project and where each stands (FR-S01 – FR-S04). */
export function ChangesPage() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useChanges(p.id);
  const [creating, setCreating] = useState(false);
  if (query.isPending) return <Skeleton className="h-64 rounded-lg" />;
  if (query.isError) {
    return (
      <ErrorState
        message={changeMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const { changes, access } = query.data.data;
  return (
    <Card
      title="Change requests"
      action={
        access.create ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New change request
          </Button>
        ) : undefined
      }
    >
      {changes.length === 0 ? (
        <EmptyState
          icon={<GitPullRequestArrow aria-hidden className="size-5" />}
          title="No change requests"
          description="Extra work, new pages or a later date go here first. The scope and budget change only when the client accepts."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {changes.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/app/projects/${p.id}/changes/${c.id}`}
                  className="break-words text-sm font-medium text-text hover:text-primary-strong"
                >
                  <span className="tabular text-muted">{c.reference}</span> {c.title}
                </Link>
                <p className="text-xs text-muted">
                  Requested by {c.requestedBy.name}
                  {c.priceMinor !== null
                    ? ` · ${formatMoney(c.priceMinor, c.currency)} excl. tax`
                    : ''}
                  {c.newDueOn ? ` · new due date ${formatDay(c.newDueOn, timeZone)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {c.requestedBy.client ? <Badge tone="info">From the client</Badge> : null}
                <ChangeStatusBadge status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewChangeDialog onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}
