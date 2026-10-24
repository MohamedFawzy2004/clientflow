import type { PipelineSummary } from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { notFound } from '../../lib/errors.js';

export const DEFAULT_STAGES = ['New', 'Qualified', 'Discovery call', 'Proposal', 'Negotiation'];

type Tx = Prisma.TransactionClient;

/** Creates the agency's default pipeline. Called at bootstrap (and backfilled by migration). */
export async function createDefaultPipeline(tx: Tx, agencyId: string) {
  return tx.pipeline.create({
    data: {
      agencyId,
      name: 'Sales pipeline',
      isDefault: true,
      stages: { create: DEFAULT_STAGES.map((name, position) => ({ name, position })) },
    },
  });
}

export async function getDefaultPipeline(db: Db | Tx, agencyId: string) {
  const pipeline = await db.pipeline.findFirst({
    where: { agencyId, isDefault: true },
    include: { stages: { where: { active: true }, orderBy: { position: 'asc' } } },
  });
  if (!pipeline) throw notFound();
  return pipeline;
}

export function toPipelineSummary(
  p: Awaited<ReturnType<typeof getDefaultPipeline>>,
): PipelineSummary {
  return {
    id: p.id,
    name: p.name,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, position: s.position })),
  };
}
