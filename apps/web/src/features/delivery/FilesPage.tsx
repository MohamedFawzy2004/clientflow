import { useRef, useState } from 'react';
import { Download, FileText, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes, type FileView } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { downloadFile, useDeleteFile, useFiles, useUpload } from './api';
import { deliveryMessage } from './TaskBoardPage';

/** Picks one file and uploads it; the server decides whether it is acceptable. */
export function UploadButton({
  projectId,
  extensions,
  maxBytes,
  onUploaded,
  label = 'Upload a file',
}: {
  projectId: string;
  extensions: string[];
  maxBytes: number;
  onUploaded?: (file: FileView) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUpload(projectId);
  const pick = (file: File | undefined) => {
    if (!file) return;
    // Quick feedback only; the API enforces the limit and checks the content.
    if (file.size > maxBytes) {
      toast.error(`“${file.name}” is larger than ${formatBytes(maxBytes)}.`);
      return;
    }
    upload.mutate(file, {
      onSuccess: (res) => {
        toast.success(`Uploaded “${res.data.name}”`);
        onUploaded?.(res.data);
      },
      onError: (err) => toast.error(deliveryMessage(err)),
      onSettled: () => {
        if (input.current) input.current.value = '';
      },
    });
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={extensions.map((e) => `.${e}`).join(',')}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button
        variant="secondary"
        onClick={() => input.current?.click()}
        loading={upload.isPending}
        loadingLabel="Uploading and checking…"
      >
        <Upload aria-hidden className="size-4" /> {label}
      </Button>
    </>
  );
}

function scanBadge(f: FileView) {
  if (f.scanStatus === 'CLEAN') {
    return (
      <Badge tone="success" icon={<ShieldCheck aria-hidden className="size-3.5" />}>
        Checked
      </Badge>
    );
  }
  return (
    <Badge tone="warning">
      {f.scanStatus === 'PENDING' ? 'Waiting for checks' : 'Quarantined'}
    </Badge>
  );
}

export async function startDownload(fileId: string, portal = false) {
  try {
    await downloadFile(fileId, portal);
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'The download could not start.');
  }
}

/** Private project files (FR-X05). Nothing here is visible to the client unless it is published. */
export function FilesPage() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const query = useFiles(p.id);
  const remove = useDeleteFile();
  const [deleting, setDeleting] = useState<FileView | null>(null);

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
  const { files, limits, access } = query.data.data;
  return (
    <Card
      title="Files"
      action={
        access.upload ? (
          <UploadButton
            projectId={p.id}
            extensions={limits.extensions}
            maxBytes={limits.maxBytes}
          />
        ) : undefined
      }
    >
      <p className="text-[13px] text-muted">
        Private to the project team and stored encrypted. Up to {formatBytes(limits.maxBytes)} per
        file: {limits.extensions.map((e) => `.${e}`).join(', ')}. Web pages, SVG and scripts are
        refused. Clients only see files you publish in a deliverable.
      </p>
      {files.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<FileText aria-hidden className="size-5" />}
          title="No files yet"
          description="Upload briefs, designs and drafts here, then add them to a deliverable."
        />
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium text-text">{f.name}</p>
                <p className="text-xs text-muted">
                  {formatBytes(f.sizeBytes)} · {f.uploadedBy.name} ·{' '}
                  {formatDateTime(f.createdAt, user?.agency.timezone)}
                  {f.usedIn ? ` · in “${f.usedIn.title}” v${f.usedIn.versionNo}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {scanBadge(f)}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={f.scanStatus !== 'CLEAN'}
                  onClick={() => startDownload(f.id)}
                >
                  <Download aria-hidden className="size-3.5" /> Download
                  <span className="sr-only"> {f.name}</span>
                </Button>
                {f.access.delete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setDeleting(f)}
                  >
                    Delete<span className="sr-only"> {f.name}</span>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this file?"
        description={deleting ? `“${deleting.name}” is removed from storage for good.` : undefined}
        confirmLabel="Delete file"
        pendingLabel="Deleting…"
        pending={remove.isPending}
        error={remove.error ? deliveryMessage(remove.error) : null}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('File deleted');
              setDeleting(null);
            },
          })
        }
      />
    </Card>
  );
}
