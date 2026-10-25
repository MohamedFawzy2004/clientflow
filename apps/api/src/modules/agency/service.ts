import {
  can,
  type agencySettingsSchema,
  type AgencySettings,
  type Currency,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { Agency } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { forbidden, staleVersion } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';

function toSettings(a: Agency): AgencySettings {
  return {
    id: a.id,
    name: a.name,
    contactEmail: a.contactEmail,
    phone: a.phone,
    address: a.address,
    defaultCurrency: a.defaultCurrency as Currency,
    timeZone: a.timezone,
    workingDays: a.workingDays,
    version: a.version,
  };
}

function assertCanManage(actor: AuthUser) {
  if (!can(actor.role, 'agency.manage')) {
    throw forbidden('Only an owner or admin can change agency settings.');
  }
}

export async function getAgencySettings(db: Db, actor: AuthUser) {
  assertCanManage(actor);
  return toSettings(await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } }));
}

/**
 * Updates the agency profile (FR-I09). The default currency only affects new deals; existing
 * amounts keep their own currency. A timezone change moves "today" for follow-ups and expiry.
 */
export async function updateAgencySettings(
  db: Db,
  actor: AuthUser,
  input: z.output<typeof agencySettingsSchema>,
  requestId: string,
) {
  assertCanManage(actor);
  const before = await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } });
  const res = await db.agency.updateMany({
    where: { id: actor.agencyId, version: input.version },
    data: {
      name: input.name,
      contactEmail: input.contactEmail,
      phone: input.phone,
      address: input.address,
      defaultCurrency: input.defaultCurrency,
      timezone: input.timeZone,
      workingDays: input.workingDays,
      version: { increment: 1 },
    },
  });
  if (res.count === 0) throw staleVersion();
  const changed = (
    [
      ['name', before.name !== input.name],
      ['contactEmail', before.contactEmail !== input.contactEmail],
      ['phone', before.phone !== input.phone],
      ['address', before.address !== input.address],
      ['defaultCurrency', before.defaultCurrency !== input.defaultCurrency],
      ['timeZone', before.timezone !== input.timeZone],
      ['workingDays', before.workingDays.join() !== input.workingDays.join()],
    ] as const
  )
    .filter(([, c]) => c)
    .map(([k]) => k);
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'agency.update',
    outcome: 'SUCCESS',
    targetType: 'agency',
    targetId: actor.agencyId,
    requestId,
    metadata: { changed: changed.join(',') },
  });
  return getAgencySettings(db, actor);
}
