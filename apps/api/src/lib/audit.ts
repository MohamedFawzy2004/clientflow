import type { Prisma } from '../generated/prisma/client.js';
import type { AuditOutcome } from '../generated/prisma/enums.js';

type AuditWriter = Pick<Prisma.TransactionClient, 'auditEvent'>;

export interface AuditInput {
  agencyId?: string | null;
  actorId?: string | null;
  action: string;
  outcome: AuditOutcome;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  /** Must never contain passwords, tokens, cookies or full PII (SEC-17). */
  metadata?: Record<string, string | number | boolean | null>;
}

const FORBIDDEN_METADATA_KEYS = /pass|token|secret|cookie|authorization|email|phone/i;

export async function writeAudit(db: AuditWriter, input: AuditInput): Promise<void> {
  const metadata = input.metadata
    ? Object.fromEntries(
        Object.entries(input.metadata).filter(([key]) => !FORBIDDEN_METADATA_KEYS.test(key)),
      )
    : undefined;
  await db.auditEvent.create({
    data: {
      agencyId: input.agencyId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      outcome: input.outcome,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      ...(metadata ? { metadataRedacted: metadata } : {}),
    },
  });
}
