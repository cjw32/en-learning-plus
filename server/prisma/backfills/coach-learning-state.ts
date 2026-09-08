import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  LegacyLearningStateBackfillRepository,
  MasteredWordStateSeed,
  runLegacyLearningStateBackfill,
} from '../../libs/learning/src/review/legacy-learning-state.backfill';
import { PrismaClient } from '../../libs/shared/src/generated/prisma/client';

const CONFIRMATION = 'coach-learning-state-v1';

class PrismaBackfillRepository
  implements LegacyLearningStateBackfillRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  listLegacyUsers() {
    return this.prisma.user.findMany({
      select: { id: true, wordNumber: true },
      orderBy: { id: 'asc' },
    });
  }

  listLegacyWordRecords() {
    return this.prisma.wordBookRecord.findMany({
      select: {
        userId: true,
        wordId: true,
        isMaster: true,
        updatedAt: true,
      },
      orderBy: [{ userId: 'asc' }, { wordId: 'asc' }],
    });
  }

  listWordStates() {
    return this.prisma.learningItemState.findMany({
      where: { targetType: 'WORD' },
      select: { userId: true, targetKey: true, wordId: true },
      orderBy: [{ userId: 'asc' }, { targetKey: 'asc' }],
    });
  }

  async upsertMasteredWordState(state: MasteredWordStateSeed) {
    await this.prisma.learningItemState.upsert({
      where: {
        userId_targetType_targetKey: {
          userId: state.userId,
          targetType: state.targetType,
          targetKey: state.targetKey,
        },
      },
      update: {},
      create: state,
    });
  }
}

async function main() {
  if (process.env.COACH_BACKFILL_CONFIRM !== CONFIRMATION) {
    throw new Error(`COACH_BACKFILL_CONFIRM must equal ${CONFIRMATION}`);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const rolloutAt = new Date(process.env.COACH_ROLLOUT_AT ?? '');
  if (Number.isNaN(rolloutAt.getTime())) {
    throw new Error('COACH_ROLLOUT_AT must be a fixed ISO-8601 timestamp');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const summary = await runLegacyLearningStateBackfill(
      new PrismaBackfillRepository(prisma),
      {
        rolloutAt,
        auditOnly: process.argv.includes('--audit-only'),
      },
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!summary.writeSafe) {
      throw new Error('Coach write enablement blocked by backfill audit');
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Backfill failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
