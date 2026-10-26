// Private project files (FR-X05 – FR-X07, SEC-12, SEC-13, US-20).
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  FILE_EXTENSIONS,
  FILE_TYPES,
  fileExtension,
  formatBytes,
  isAllowedExtension,
  type DownloadLink,
  type FileList,
  type FileView,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, notFound, validationFailed } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import {
  assertNotArchived,
  canManage,
  canWork,
  findWorkable,
  projectReadScope,
} from '../projects/access.js';
import { logPortalDenied, portalProjectScope } from '../portal/scope.js';
import { ContentInspector, safeFileName, TooLargeError } from './inspect.js';
import { signDownloadLink, verifyDownloadLink } from './links.js';

export const DEFAULT_PROJECT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

const tooLarge = (max: number) =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', `Files can be at most ${formatBytes(max)}.`);

const fileInclude = {
  uploadedBy: { select: { id: true, name: true } },
  deliverableVersion: {
    select: { versionNo: true, deliverable: { select: { id: true, title: true } } },
  },
} as const satisfies Prisma.StoredFileInclude;
type FileRow = Prisma.StoredFileGetPayload<{ include: typeof fileInclude }>;

function toView(f: FileRow, canDelete: boolean): FileView {
  return {
    id: f.id,
    name: f.originalName,
    extension: f.extension,
    sizeBytes: f.sizeBytes,
    sha256: f.sha256,
    scanStatus: f.scanStatus,
    uploadedBy: f.uploadedBy,
    createdAt: f.createdAt.toISOString(),
    usedIn: f.deliverableVersion
      ? {
          deliverableId: f.deliverableVersion.deliverable.id,
          title: f.deliverableVersion.deliverable.title,
          versionNo: f.deliverableVersion.versionNo,
        }
      : null,
    access: { delete: canDelete && !f.deliverableVersion },
  };
}

function limits(deps: AppDeps) {
  return {
    maxBytes: deps.config.files?.maxBytes ?? 0,
    projectQuotaBytes: deps.config.files?.projectQuotaBytes ?? DEFAULT_PROJECT_QUOTA_BYTES,
  };
}

export async function listFiles(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
): Promise<FileList> {
  const { db } = deps;
  const p = await findWorkable(db, actor, projectId);
  const rows = await db.storedFile.findMany({
    where: { projectId: p.id },
    include: fileInclude,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const archived = p.state === 'ARCHIVED';
  const manage = canManage(actor, p);
  return {
    files: rows.map((f) => toView(f, !archived && (manage || f.uploadedById === actor.id))),
    limits: { maxBytes: limits(deps).maxBytes, extensions: FILE_EXTENSIONS },
    access: { upload: !archived },
  };
}

/**
 * Streams one upload: the body is the raw file, `X-File-Name` carries its name (URI-encoded).
 * The bytes are checked while they are encrypted to storage; a file that fails any check is
 * removed again and refused, so nothing unchecked is ever stored as available (FR-X06).
 */
export async function uploadFile(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  req: Request,
): Promise<FileView> {
  const { db, storage } = deps;
  const { maxBytes, projectQuotaBytes } = limits(deps);
  const p = await findWorkable(db, actor, projectId);
  assertNotArchived(p);

  let rawName = '';
  try {
    rawName = decodeURIComponent(req.get('x-file-name') ?? '');
  } catch {
    rawName = '';
  }
  if (!rawName.trim() || rawName.length > 300) {
    throw validationFailed({ file: ['Send the file name in the X-File-Name header.'] });
  }
  const ext = fileExtension(rawName);
  if (!isAllowedExtension(ext)) {
    await writeAudit(db, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'file.rejected',
      outcome: 'FAILURE',
      targetType: 'project',
      targetId: p.id,
      requestId: req.requestId,
      metadata: { reason: 'type', extension: ext.slice(0, 10) },
    });
    throw validationFailed({
      file: [
        `This file type is not accepted. Allowed: ${FILE_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
      ],
    });
  }
  const declared = Number(req.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  const used = await db.storedFile.aggregate({
    where: { projectId: p.id },
    _sum: { sizeBytes: true },
  });
  const room = projectQuotaBytes - (used._sum.sizeBytes ?? 0);
  if (room <= 0 || (Number.isFinite(declared) && declared > room)) {
    throw conflict(`This project has used its ${formatBytes(projectQuotaBytes)} of file storage.`);
  }

  const inspector = new ContentInspector(ext, Math.min(maxBytes, room));
  const key = randomUUID();
  let meta;
  try {
    meta = await storage.put(key, tapped(req, inspector));
  } catch (err) {
    if (err instanceof TooLargeError) {
      req.resume(); // drain the rest so the client gets the answer
      throw tooLarge(maxBytes);
    }
    throw err;
  }
  const result = inspector.finish();
  if (result.size === 0 || !result.finding.ok) {
    await storage.remove(key);
    const reason =
      result.size === 0 ? 'The file is empty.' : result.finding.ok ? '' : result.finding.reason;
    await writeAudit(db, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'file.rejected',
      outcome: 'FAILURE',
      targetType: 'project',
      targetId: p.id,
      requestId: req.requestId,
      metadata: { reason: reason.slice(0, 100), extension: ext },
    });
    throw validationFailed({ file: [reason] });
  }

  const name = safeFileName(rawName, ext);
  try {
    const row = await db.$transaction(async (tx) => {
      const f = await tx.storedFile.create({
        data: {
          agencyId: actor.agencyId,
          projectId: p.id,
          uploadedById: actor.id,
          storageKey: key,
          originalName: name,
          extension: ext,
          mimeType: FILE_TYPES[ext].mime,
          sizeBytes: result.size,
          sha256: result.sha256,
          scanStatus: 'CLEAN',
          scanDetail: 'Built-in checks passed: type signature, active content, test signature.',
          scannedAt: new Date(),
          encIv: meta.iv ? Buffer.from(meta.iv) : null,
          encTag: meta.tag ? Buffer.from(meta.tag) : null,
        },
        include: fileInclude,
      });
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: p.id,
        eventType: 'file.uploaded',
        summary: `${actor.name} uploaded “${name}” (${formatBytes(result.size)})`,
      });
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: 'file.upload',
        outcome: 'SUCCESS',
        targetType: 'file',
        targetId: f.id,
        requestId: req.requestId,
        metadata: { projectId: p.id, extension: ext, sizeBytes: result.size },
      });
      return f;
    });
    return toView(row, true);
  } catch (err) {
    await storage.remove(key);
    throw err;
  }
}

/** Passes the request body to storage, checking every chunk on the way. */
async function* tapped(req: Request, inspector: ContentInspector) {
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    inspector.update(buf);
    yield buf;
  }
}

// ---------------------------------------------------------------------------
// Access checks shared by link creation and download
// ---------------------------------------------------------------------------

/** Staff: files of projects they work on. Only CLEAN files leave storage (T-FILE-01). */
async function staffFile(db: Db, actor: AuthUser, fileId: string) {
  if (!canWork(actor)) throw forbidden('Files are for the project team.');
  if (!UUID_PATTERN.test(fileId)) throw notFound();
  const f = await db.storedFile.findFirst({
    where: { id: fileId, agencyId: actor.agencyId, project: projectReadScope(actor) },
    include: { project: true },
  });
  if (!f) throw notFound();
  return f;
}

/** Clients: only the file of a published version on a project shared with them (US-20). */
async function clientFile(db: Db, actor: AuthUser, fileId: string) {
  const scope = portalProjectScope(actor);
  if (!UUID_PATTERN.test(fileId)) return null;
  return db.storedFile.findFirst({
    where: {
      id: fileId,
      agencyId: actor.agencyId,
      scanStatus: 'CLEAN',
      deliverableVersion: {
        publishedAt: { not: null },
        deliverable: { status: { not: 'ARCHIVED' }, project: scope },
      },
    },
  });
}

function assertClean(f: { scanStatus: string }) {
  if (f.scanStatus !== 'CLEAN') {
    throw conflict('This file has not passed the upload checks, so it cannot be downloaded.');
  }
}

export async function createDownloadLink(
  deps: AppDeps,
  actor: AuthUser,
  fileId: string,
  requestId: string,
): Promise<DownloadLink> {
  if (actor.role === 'CLIENT') {
    const f = await clientFile(deps.db, actor, fileId);
    if (!f) {
      await logPortalDenied(deps.db, actor, 'file', fileId, requestId);
      throw notFound();
    }
  } else {
    assertClean(await staffFile(deps.db, actor, fileId));
  }
  const { token, expiresAt } = signDownloadLink(deps.config.csrfSecret, fileId, actor.id);
  return { url: `/api/v1/files/download/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
function disposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serves a file for a valid link, to the user it was made for, after checking access again
 * (sharing may have been revoked since). Always an attachment, never rendered by the browser on
 * this origin (FR-X07, SEC-13).
 */
export async function serveDownload(
  deps: AppDeps,
  actor: AuthUser,
  token: string,
  req: Request,
  res: Response,
) {
  const { db, storage, config } = deps;
  const link = verifyDownloadLink(config.csrfSecret, token);
  if (!link || link.userId !== actor.id) throw notFound();
  let f;
  if (actor.role === 'CLIENT') {
    f = await clientFile(db, actor, link.fileId);
    if (!f) {
      await logPortalDenied(db, actor, 'file', link.fileId, req.requestId);
      throw notFound();
    }
  } else {
    f = await staffFile(db, actor, link.fileId);
    assertClean(f);
  }
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'file.download',
    outcome: 'SUCCESS',
    targetType: 'file',
    targetId: f.id,
    requestId: req.requestId,
  });
  res.status(200);
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Length', String(f.sizeBytes));
  res.setHeader('Content-Disposition', disposition(f.originalName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = storage.get(f.storageKey, { iv: f.encIv, tag: f.encTag });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** The uploader or the project manager removes a file no deliverable version uses. */
export async function deleteFile(
  deps: AppDeps,
  actor: AuthUser,
  fileId: string,
  requestId: string,
) {
  const { db, storage } = deps;
  const f = await staffFile(db, actor, fileId);
  assertNotArchived(f.project);
  if (!canManage(actor, f.project) && f.uploadedById !== actor.id) {
    throw forbidden('Only the person who uploaded it or the project manager can delete it.');
  }
  const used = await db.deliverableVersion.count({ where: { fileId: f.id } });
  if (used > 0)
    throw conflict('This file is part of a deliverable version and is kept as history.');
  await db.$transaction(async (tx) => {
    await tx.storedFile.delete({ where: { id: f.id } });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: f.projectId,
      eventType: 'file.deleted',
      summary: `${actor.name} deleted “${f.originalName}”`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'file.delete',
      outcome: 'SUCCESS',
      targetType: 'file',
      targetId: f.id,
      requestId,
    });
  });
  await storage.remove(f.storageKey);
  return { deleted: true };
}
