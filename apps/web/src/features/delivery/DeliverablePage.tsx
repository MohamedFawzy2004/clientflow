import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Download, Send, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { DELIVERABLE_DECISION_LABELS, formatBytes } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { DeliverableStatusBadge, OverdueBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useDeliverable, useDeliverableAction, useFiles } from './api';
import { startDownload, UploadButton } from './FilesPage';
import { deliveryMessage } from './TaskBoardPage';
import { CommentsThread } from '../changes/CommentsThread';

/** Adds the next version: an uploaded file of this project that no other version uses. */
function AddVersion({ deliverableId }: { deliverableId: string }) {
  const p = useProjectContext();
  const files = useFiles(p.id);
  const action = useDeliverableAction();
  const [fileId, setFileId] = useState('');
  const [note, setNote] = useState('');
  const free = (files.data?.data.files ?? []).filter((f) => !f.usedIn && f.scanStatus === 'CLEAN');
  const add = () =>
    action.mutate(
      { kind: 'version', id: deliverableId, fileId, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setFileId('');
          setNote('');
          toast.success('Version added. Publish it when it is ready for the client.');
        },
        onError: (err) => toast.error(deliveryMessage(err)),
      },
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="version-file" className="text-[13px] font-medium text-text">
            File for the next version
          </label>
          <Select
            id="version-file"
            className="mt-1.5"
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
          >
            <option value="">{free.length ? 'Choose a file…' : 'Upload a file first'}</option>
            {free.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({formatBytes(f.sizeBytes)})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="version-note" className="text-[13px] font-medium text-text">
            Note for the client <span className="font-normal text-muted">(optional)</span>
          </label>
          <Input
            id="version-note"
            className="mt-1.5"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {files.data ? (
          <UploadButton
            projectId={p.id}
            extensions={files.data.data.limits.extensions}
            maxBytes={files.data.data.limits.maxBytes}
            onUploaded={(f) => setFileId(f.id)}
            label="Upload new file"
          />
        ) : null}
        <Button disabled={!fileId} loading={action.isPending} loadingLabel="Adding…" onClick={add}>
          Add version
        </Button>
      </div>
    </div>
  );
}

/** One deliverable: versions, client decisions and the explicit publish (FR-S06 – FR-S08). */
export function DeliverablePage() {
  const p = useProjectContext();
  const { deliverableId = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useDeliverable(deliverableId);
  const action = useDeliverableAction();
  const [confirm, setConfirm] = useState<'publish' | 'archive' | null>(null);
  const back = (
    <Link
      to={`/app/projects/${p.id}/deliverables`}
      className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> All deliverables
    </Link>
  );
  if (query.isPending) return <Skeleton className="h-72 rounded-lg" />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Deliverable not found"
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={deliveryMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const d = query.data.data;
  const run = (kind: 'publish' | 'archive') =>
    action.mutate(
      { kind, id: d.id, version: d.version },
      {
        onSuccess: () => {
          toast.success(kind === 'publish' ? 'Published to the client' : 'Deliverable archived');
          setConfirm(null);
        },
      },
    );
  const canArchive = p.access.manage && d.status !== 'ARCHIVED';
  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card
        title={d.title}
        action={
          <span className="flex items-center gap-2">
            {d.overdue ? <OverdueBadge /> : null}
            <DeliverableStatusBadge status={d.status} />
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          {d.description ? (
            <p className="whitespace-pre-line break-words text-sm leading-6 text-text">
              {d.description}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {d.milestone ? `Milestone: ${d.milestone.title}. ` : ''}
            {d.reviewDueOn
              ? `The client is asked to review by ${formatDay(d.reviewDueOn, timeZone)}.`
              : 'No review date set.'}
          </p>
          {d.status === 'PUBLISHED' ? (
            <Banner tone="info" title={`Version ${d.publishedVersionNo} is with the client`}>
              They can approve it, ask for a revision or reject it. Silence is never treated as
              approval{d.overdue ? ', and the review date has passed' : ''}.
            </Banner>
          ) : d.status === 'APPROVED' ? (
            <Banner tone="success" title="Approved by the client">
              This deliverable is closed. Start a new one for further work.
            </Banner>
          ) : d.status === 'REVISION_REQUESTED' ? (
            <Banner tone="warning" title="The client asked for changes">
              Read their reason below, then add a new version.
            </Banner>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {d.access.publish ? (
              <Button onClick={() => setConfirm('publish')}>
                <Send aria-hidden className="size-4" /> Publish version {d.currentVersionNo} to the
                client
              </Button>
            ) : null}
            {canArchive ? (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirm('archive')}>
                Archive
              </Button>
            ) : null}
          </div>
          {d.status === 'READY' && !p.access.manage ? (
            <p className="text-[13px] text-muted">
              The project manager publishes it to the client.
            </p>
          ) : null}
        </div>
      </Card>

      <Card title="Versions">
        {d.versions.length === 0 ? (
          <p className="text-sm text-muted">No version yet. Add a file below.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {d.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">
                    Version {v.versionNo}
                    <span className="font-normal text-muted"> · {v.file.name}</span>
                  </p>
                  <span className="flex flex-wrap items-center gap-2">
                    {v.publishedAt ? (
                      <Badge tone="primary">Published</Badge>
                    ) : (
                      <Badge>Private</Badge>
                    )}
                    {v.review ? (
                      <Badge tone={v.review.decision === 'APPROVED' ? 'success' : 'warning'}>
                        {DELIVERABLE_DECISION_LABELS[v.review.decision]}
                      </Badge>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => startDownload(v.file.id)}>
                      <Download aria-hidden className="size-3.5" /> Download
                      <span className="sr-only"> version {v.versionNo}</span>
                    </Button>
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Added by {v.createdBy.name}, {formatDateTime(v.createdAt, timeZone)}
                  {v.publishedAt ? ` · published ${formatDateTime(v.publishedAt, timeZone)}` : ''}
                </p>
                {v.note ? <p className="break-words text-sm text-text">{v.note}</p> : null}
                {v.review ? (
                  <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-text">
                    <span className="font-medium">{v.review.by}</span> ·{' '}
                    {formatDateTime(v.review.at, timeZone)}
                    {v.review.reason ? (
                      <span className="mt-1 block whitespace-pre-line break-words">
                        {v.review.reason}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {d.access.edit && d.status !== 'PUBLISHED' ? (
          <div className="mt-4 border-t border-border pt-4">
            <AddVersion deliverableId={d.id} />
          </div>
        ) : null}
      </Card>

      <CommentsThread
        thread={{ entityType: 'deliverable', entityId: d.id, projectId: p.id }}
        readOnly={p.state === 'ARCHIVED'}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === 'publish'
            ? `Publish version ${d.currentVersionNo}?`
            : 'Archive this deliverable?'
        }
        description={
          confirm === 'publish'
            ? 'The client people this project is shared with will see this version and can decide on it. A published version cannot be changed.'
            : 'It leaves the team list and the client portal. Its history is kept.'
        }
        confirmLabel={confirm === 'publish' ? 'Publish' : 'Archive'}
        pendingLabel={confirm === 'publish' ? 'Publishing…' : 'Archiving…'}
        tone={confirm === 'publish' ? 'primary' : 'danger'}
        pending={action.isPending}
        error={action.error ? deliveryMessage(action.error) : null}
        onConfirm={() => confirm && run(confirm)}
      />
    </div>
  );
}
