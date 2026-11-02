// Comment threads on deliverables and changes, shared by the project team and the client (FR-X08).
// Edits and deletions keep the earlier text as append-only revisions.
import type {
  CommentEntityType,
  CommentRevisionView,
  CommentView,
  commentCreateSchema,
  commentThreadQuerySchema,
  commentUpdateSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { conflict, forbidden, notFound, staleVersion } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { canWork, findWorkable, projectReadScope } from '../projects/access.js';
import { logPortalDenied, portalProjectScope } from '../portal/scope.js';

type Thread = { projectId: string; entityType: CommentEntityType; entityId: string };

/** Staff: the item must belong to the project they work on. */
async function staffThread(
  db: Db,
  actor: AuthUser,
  projectId: string,
  entityType: CommentEntityType,
  entityId: string,
): Promise<Thread & { archived: boolean }> {
  const p = await findWorkable(db, actor, projectId);
  const found =
    entityType === 'deliverable'
      ? await db.deliverable.findFirst({
          where: { id: entityId, projectId: p.id },
          select: { id: true },
        })
      : await db.changeRequest.findFirst({
          where: { id: entityId, projectId: p.id },
          select: { id: true },
        });
  if (!found) throw notFound();
  return { projectId: p.id, entityType, entityId, archived: p.state === 'ARCHIVED' };
}

/** Clients: only items they can see in the portal (published deliverables, visible changes). */
async function clientThread(
  db: Db,
  actor: AuthUser,
  entityType: CommentEntityType,
  entityId: string,
  requestId: string,
): Promise<Thread> {
  const scope = portalProjectScope(actor);
  const row = !UUID_PATTERN.test(entityId)
    ? null
    : entityType === 'deliverable'
      ? await db.deliverable.findFirst({
          where: {
            id: entityId,
            status: { not: 'ARCHIVED' },
            versions: { some: { publishedAt: { not: null } } },
            project: scope,
          },
          select: { projectId: true },
        })
      : await db.changeRequest.findFirst({
          where: {
            id: entityId,
            project: scope,
            OR: [
              { versions: { some: { sentAt: { not: null } } } },
              { requestedByClient: true, requestedBy: { clientOrgId: actor.clientOrgId } },
            ],
          },
          select: { projectId: true },
        });
  if (!row) {
    await logPortalDenied(db, actor, entityType, entityId, requestId);
    throw notFound();
  }
  return { projectId: row.projectId, entityType, entityId };
}

const commentInclude = {
  author: { select: { id: true, name: true, role: true } },
} as const satisfies Prisma.ProjectCommentInclude;

function toView(
  c: Prisma.ProjectCommentGetPayload<{ include: typeof commentInclude }>,
  actor: AuthUser,
): CommentView {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    author: { id: c.author.id, name: c.author.name, client: c.author.role === 'CLIENT' },
    body: deleted ? null : c.body,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
    deleted,
    version: c.version,
    mine: c.authorId === actor.id,
  };
}

async function listThread(db: Db, actor: AuthUser, t: Thread) {
  const rows = await db.projectComment.findMany({
    where: { projectId: t.projectId, entityType: t.entityType, entityId: t.entityId },
    include: commentInclude,
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  return rows.map((c) => toView(c, actor));
}

async function addComment(
  deps: AppDeps,
  actor: AuthUser,
  t: Thread,
  body: string,
  requestId: string,
) {
  const { db } = deps;
  const c = await db.$transaction(async (tx) => {
    const created = await tx.projectComment.create({
      data: {
        agencyId: actor.agencyId,
        projectId: t.projectId,
        entityType: t.entityType,
        entityId: t.entityId,
        authorId: actor.id,
        body,
      },
      include: commentInclude,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'comment.create',
      outcome: 'SUCCESS',
      targetType: 'comment',
      targetId: created.id,
      requestId,
      metadata: { entityType: t.entityType },
    });
    // A client comment is easy to miss: tell the project manager (FR-X09).
    if (actor.role === 'CLIENT') {
      const p = await tx.project.findUniqueOrThrow({
        where: { id: t.projectId },
        select: { managerId: true, title: true },
      });
      const path =
        t.entityType === 'deliverable' ? `deliverables/${t.entityId}` : `changes/${t.entityId}`;
      await notify(tx, {
        agencyId: actor.agencyId,
        recipientIds: [p.managerId],
        actorId: actor.id,
        category: 'CLIENT_ACTIVITY',
        type: 'comment.client',
        title: `${actor.name} (client) commented on a ${t.entityType === 'deliverable' ? 'deliverable' : 'change'} in ${p.title}`,
        link: `/app/projects/${t.projectId}/${path}`,
        entity: { type: 'comment', id: created.id },
      });
    }
    return created;
  });
  return toView(c, actor);
}

/** The author's own comment, or 403 when someone else's is visible; edits keep the old text. */
async function changeOwnComment(
  db: Db,
  actor: AuthUser,
  commentId: string,
  version: number,
  next: { body: string } | { delete: true },
  visible: (c: { projectId: string; entityType: string; entityId: string }) => Promise<void>,
  requestId: string,
) {
  if (!UUID_PATTERN.test(commentId)) throw notFound();
  const c = await db.projectComment.findFirst({
    where: { id: commentId, agencyId: actor.agencyId },
  });
  if (!c) throw notFound();
  await visible(c);
  if (c.authorId !== actor.id) throw forbidden('Only the author can change a comment.');
  if (c.deletedAt) throw conflict('This comment was deleted.');
  if (c.version !== version) throw staleVersion();
  const isDelete = 'delete' in next;
  await db.$transaction(async (tx) => {
    const res = await tx.projectComment.updateMany({
      where: { id: c.id, version },
      data: isDelete
        ? { deletedAt: new Date(), version: { increment: 1 } }
        : { body: next.body, editedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count === 0) throw staleVersion();
    await tx.projectCommentRevision.create({ data: { commentId: c.id, body: c.body } });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: isDelete ? 'comment.delete' : 'comment.edit',
      outcome: 'SUCCESS',
      targetType: 'comment',
      targetId: c.id,
      requestId,
    });
  });
  const fresh = await db.projectComment.findUniqueOrThrow({
    where: { id: c.id },
    include: commentInclude,
  });
  return toView(fresh, actor);
}

async function revisions(db: Db, commentId: string): Promise<CommentRevisionView[]> {
  const rows = await db.projectCommentRevision.findMany({
    where: { commentId },
    orderBy: { replacedAt: 'asc' },
  });
  return rows.map((r) => ({ body: r.body, replacedAt: r.replacedAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function staffListComments(
  db: Db,
  actor: AuthUser,
  projectId: string,
  q: z.output<typeof commentThreadQuerySchema>,
) {
  return listThread(db, actor, await staffThread(db, actor, projectId, q.entityType, q.entityId));
}

export async function staffAddComment(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof commentCreateSchema>,
  requestId: string,
) {
  const t = await staffThread(deps.db, actor, projectId, input.entityType, input.entityId);
  if (t.archived) throw conflict('Archived projects are read-only.');
  return addComment(deps, actor, t, input.body, requestId);
}

async function staffVisible(db: Db, actor: AuthUser, c: { projectId: string }) {
  if (!canWork(actor)) throw forbidden('Comments are for the project team.');
  const p = await db.project.findFirst({
    where: { AND: [projectReadScope(actor), { id: c.projectId }] },
    select: { id: true },
  });
  if (!p) throw notFound();
}

export async function staffUpdateComment(
  db: Db,
  actor: AuthUser,
  commentId: string,
  input: z.output<typeof commentUpdateSchema>,
  requestId: string,
) {
  return changeOwnComment(
    db,
    actor,
    commentId,
    input.version,
    { body: input.body },
    (c) => staffVisible(db, actor, c),
    requestId,
  );
}

export async function staffDeleteComment(
  db: Db,
  actor: AuthUser,
  commentId: string,
  version: number,
  requestId: string,
) {
  return changeOwnComment(
    db,
    actor,
    commentId,
    version,
    { delete: true },
    (c) => staffVisible(db, actor, c),
    requestId,
  );
}

/** The project team sees the full history of any comment in their projects. */
export async function staffCommentHistory(db: Db, actor: AuthUser, commentId: string) {
  if (!canWork(actor)) throw forbidden('Comments are for the project team.');
  if (!UUID_PATTERN.test(commentId)) throw notFound();
  const c = await db.projectComment.findFirst({
    where: { id: commentId, agencyId: actor.agencyId, project: projectReadScope(actor) },
  });
  if (!c) throw notFound();
  return revisions(db, c.id);
}

// ---------------------------------------------------------------------------
// Client portal
// ---------------------------------------------------------------------------

export async function portalListComments(
  db: Db,
  actor: AuthUser,
  q: z.output<typeof commentThreadQuerySchema>,
  requestId: string,
) {
  return listThread(db, actor, await clientThread(db, actor, q.entityType, q.entityId, requestId));
}

export async function portalAddComment(
  deps: AppDeps,
  actor: AuthUser,
  input: z.output<typeof commentCreateSchema>,
  requestId: string,
) {
  const t = await clientThread(deps.db, actor, input.entityType, input.entityId, requestId);
  return addComment(deps, actor, t, input.body, requestId);
}

async function clientVisible(
  db: Db,
  actor: AuthUser,
  c: { entityType: string; entityId: string },
  requestId: string,
) {
  await clientThread(db, actor, c.entityType as CommentEntityType, c.entityId, requestId);
}

export async function portalUpdateComment(
  db: Db,
  actor: AuthUser,
  commentId: string,
  input: z.output<typeof commentUpdateSchema>,
  requestId: string,
) {
  return changeOwnComment(
    db,
    actor,
    commentId,
    input.version,
    { body: input.body },
    (c) => clientVisible(db, actor, c, requestId),
    requestId,
  );
}

export async function portalDeleteComment(
  db: Db,
  actor: AuthUser,
  commentId: string,
  version: number,
  requestId: string,
) {
  return changeOwnComment(
    db,
    actor,
    commentId,
    version,
    { delete: true },
    (c) => clientVisible(db, actor, c, requestId),
    requestId,
  );
}

/** Clients see the history of their own comments only. */
export async function portalCommentHistory(
  db: Db,
  actor: AuthUser,
  commentId: string,
  requestId: string,
) {
  if (!UUID_PATTERN.test(commentId)) throw notFound();
  const c = await db.projectComment.findFirst({
    where: { id: commentId, agencyId: actor.agencyId, authorId: actor.id },
  });
  if (!c) {
    await logPortalDenied(db, actor, 'comment', commentId, requestId);
    throw notFound();
  }
  await clientVisible(db, actor, c, requestId);
  return revisions(db, c.id);
}
