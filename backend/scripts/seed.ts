import { prisma } from '../src/storage/prisma.js';
import { env } from '../src/config/env.js';

await prisma.modelVersion.upsert({
  where: { name: 'heuristic_mock' },
  update: {},
  create: {
    name: 'heuristic_mock',
    status: 'ACTIVE',
    endpoint: env.AI_SERVICE_URL,
    ruleVersion: env.DEFAULT_RULE_VERSION,
    observationVer: env.DEFAULT_OBSERVATION_VERSION,
    actionVersion: env.DEFAULT_ACTION_VERSION,
    metadataJson: { type: 'fallback' }
  }
});

await prisma.$disconnect();
