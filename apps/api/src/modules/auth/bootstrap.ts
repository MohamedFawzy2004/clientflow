import type { Db } from '../../db/client.js';
import { writeAudit } from '../../lib/audit.js';
import { normalizeEmail, slugify } from '../../lib/normalize.js';
import { checkPasswordPolicy, hashPassword } from '../../lib/password.js';

export interface BootstrapInput {
  agencyName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}

export class BootstrapError extends Error {
  constructor(
    readonly reason: 'already_bootstrapped' | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

// Arbitrary constant: serializes concurrent bootstrap attempts across processes.
const BOOTSTRAP_LOCK_KEY = 4_204_202_601;

/**
 * Creates the single agency and its first OWNER atomically (FR-I01, US-01).
 * Refuses to run when any agency already exists, so a second bootstrap changes nothing.
 */
export async function bootstrapOwner(db: Db, input: BootstrapInput) {
  const agencyName = input.agencyName.trim();
  const ownerName = input.ownerName.trim();
  const emailNorm = normalizeEmail(input.ownerEmail);

  if (!agencyName || agencyName.length > 200) {
    throw new BootstrapError('invalid_input', 'Agency name must be 1–200 characters.');
  }
  if (!ownerName || ownerName.length > 120) {
    throw new BootstrapError('invalid_input', 'Owner name must be 1–120 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm) || emailNorm.length > 254) {
    throw new BootstrapError('invalid_input', 'Owner email is not valid.');
  }
  const problem = checkPasswordPolicy(input.password);
  if (problem) {
    const messages = {
      too_short: 'Password must be at least 12 characters.',
      too_long: 'Password must be at most 128 characters.',
      too_common: 'Password is too common. Choose a longer, less predictable one.',
    } as const;
    throw new BootstrapError('invalid_input', messages[problem]);
  }

  // Hash outside the transaction so the lock is held only briefly.
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;
    const existing = await tx.agency.count();
    if (existing > 0) {
      throw new BootstrapError(
        'already_bootstrapped',
        'This installation already has an agency and owner. Bootstrap can only run once.',
      );
    }
    const agency = await tx.agency.create({
      data: { name: agencyName, slug: slugify(agencyName) },
    });
    const owner = await tx.user.create({
      data: { agencyId: agency.id, emailNorm, name: ownerName, passwordHash, role: 'OWNER' },
    });
    await writeAudit(tx, {
      agencyId: agency.id,
      actorId: owner.id,
      action: 'system.bootstrap_owner',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: owner.id,
    });
    return { agencyId: agency.id, ownerId: owner.id };
  });
}
