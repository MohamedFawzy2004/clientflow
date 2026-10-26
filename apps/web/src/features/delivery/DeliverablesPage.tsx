import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PackageCheck, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { DeliverableStatusBadge, OverdueBadge } from '../../components/projects/delivery-ui';
import { formatDay } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useDeliverableAction, useDeliverables } from './api';
import { deliveryMessage } from './TaskBoardPage';

function NewDeliverableDialog({ onClose }: { onClose: () => void }) {
  const p = useProjectContext();
  const navigate = useNavigate();
  const action = useDeliverableAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [reviewDueOn, setReviewDueOn] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim()) return;
    action.mutate(
      {
        kind: 'create',
        projectId: p.id,
        body: {
          title: title.trim(),
          description: description.trim() || null,
          milestoneId: milestoneId || null,
          reviewDueOn: reviewDueOn || null,
        },
      },
      {
        onSuccess: (res) => {
          toast.success('Deliverable created. It stays private until you publish it.');
          onClose();
          if (res && 'data' in res) navigate(`/app/projects/${p.id}/deliverables/${res.data.id}`);
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title="New deliverable"
      description="Something the client reviews, such as a design, a document or a release."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="deliverable-form"
            loading={action.isPending}
            loadingLabel="Creating…"
          >
            Create
          </Button>
        </>
      }
    >
      {action.error ? (
        <Banner tone="danger" title="Not created" className="mb-5">
          {deliveryMessage(action.error)}
        </Banner>
      ) : null}
      <form
        id="deliverable-form"
        onSubmit={submit}
        noValidate
        className="grid gap-5 sm:grid-cols-2"
      >
        <Field
          label="Title"
          required
          error={touched && !title.trim() ? 'Give it a name.' : undefined}
          className="sm:col-span-2"
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
        <Field label="Milestone">
          {(fp) => (
            <Select {...fp} value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
              <option value="">None</option>
              {p.milestoneList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Client review due"
          hint="Shown to the client. Late reviews are flagged, never approved."
        >
          {(fp) => (
            <Input
              {...fp}
              type="date"
              value={reviewDueOn}
              onChange={(e) => setReviewDueOn(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Description"
          className="sm:col-span-2"
          hint="Visible to the client once published."
        >
          {(fp) => (
            <Textarea
              {...fp}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Deliverables of the project and where each one stands with the client (FR-S06, FR-S09). */
export function DeliverablesPage() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useDeliverables(p.id);
  const [creating, setCreating] = useState(false);
  if (query.isPending) return <Skeleton className="h-64 rounded-lg" />;
  if (query.isError) {
    return (
      <ErrorState
        message={deliveryMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const { deliverables, access } = query.data.data;
  return (
    <Card
      title="Deliverables"
      action={
        access.create ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New deliverable
          </Button>
        ) : undefined
      }
    >
      {deliverables.length === 0 ? (
        <EmptyState
          icon={<PackageCheck aria-hidden className="size-5" />}
          title="No deliverables yet"
          description="Create one, add a file as version 1, and publish it for the client's review."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {deliverables.map((d) => (
            <li
              key={d.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/app/projects/${p.id}/deliverables/${d.id}`}
                  className="break-words text-sm font-medium text-text hover:text-primary-strong"
                >
                  {d.title}
                </Link>
                <p className="text-xs text-muted">
                  {d.currentVersionNo === 0
                    ? 'No version yet'
                    : `Version ${d.currentVersionNo}${d.publishedVersionNo ? ` · v${d.publishedVersionNo} published` : ' · not published'}`}
                  {d.milestone ? ` · ${d.milestone.title}` : ''}
                  {d.reviewDueOn ? ` · review due ${formatDay(d.reviewDueOn, timeZone)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.overdue ? <OverdueBadge /> : null}
                <DeliverableStatusBadge status={d.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewDeliverableDialog onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}
