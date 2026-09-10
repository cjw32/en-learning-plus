import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  createExerciseOutputSchema,
  exerciseDifficultySchema,
  exerciseTypeSchema,
  toolCitationSchema,
  type CreateExerciseOutput,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';

const targetSchema = z
  .object({
    targetType: z.enum(['WORD', 'ERROR_TYPE']),
    targetKey: z.string().min(1).max(128),
    wordId: z.string().optional(),
    weight: z.number().positive().max(1),
  })
  .strict();

const definitionItemSchema = z
  .object({
    prompt: z.string().min(1).max(4000),
    choices: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            text: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .min(2)
      .max(8)
      .nullable(),
    answerKey: z.record(z.string(), z.json()),
    gradingRubric: z.record(z.string(), z.json()),
    maxScore: z.number().int().min(1).max(100),
    citations: z.array(toolCitationSchema).min(1).max(10),
    targets: z.array(targetSchema).min(1).max(50),
  })
  .strict();

export const exerciseDefinitionSchema = z
  .object({
    type: exerciseTypeSchema,
    difficulty: exerciseDifficultySchema,
    instructions: z.string().min(1).max(2000),
    personalizationReason: z.string().min(1).max(2000),
    items: z.array(definitionItemSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.type === 'MULTIPLE_CHOICE' &&
      value.items.some((item) => item.choices === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'multiple choice items require choices',
      });
    }
  });

export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;

export type StoredReadyExercise = {
  id: string;
  subjectId: string;
  conversationId: string;
  requestId: string;
  type: ExerciseDefinition['type'];
  difficulty: ExerciseDefinition['difficulty'];
  instructions: string;
  personalizationReason: string;
  schemaVersion: string;
  citations: z.infer<typeof toolCitationSchema>[];
  expiresAt: Date;
  items: Array<
    ExerciseDefinition['items'][number] & { id: string; position: number }
  >;
};

export interface ExerciseRepository {
  findReadyByRequest(requestId: string): Promise<StoredReadyExercise | null>;
  createReady(input: StoredReadyExercise): Promise<StoredReadyExercise>;
  isOwnedRequestScope?(
    subjectId: string,
    conversationId: string,
    requestId: string,
  ): Promise<boolean>;
}

@Injectable()
export class PrismaExerciseRepository implements ExerciseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isOwnedRequestScope(
    subjectId: string,
    conversationId: string,
    requestId: string,
  ) {
    return Boolean(
      await this.prisma.coachRequest.findFirst({
        where: { id: requestId, userId: subjectId, conversationId },
        select: { id: true },
      }),
    );
  }

  async findReadyByRequest(requestId: string) {
    const exercise = await this.prisma.exercise.findFirst({
      where: { requestId, status: 'READY' },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: {
            targets: {
              where: { targetType: { in: ['WORD', 'ERROR_TYPE'] } },
            },
          },
        },
      },
    });
    if (!exercise) return null;
    return {
      id: exercise.id,
      subjectId: exercise.userId,
      conversationId: exercise.conversationId,
      requestId: exercise.requestId,
      type: exercise.type,
      difficulty: exercise.cefrDifficulty,
      instructions: exercise.instructions,
      personalizationReason: exercise.personalizationReason,
      schemaVersion: exercise.schemaVersion,
      citations: z.array(toolCitationSchema).parse(exercise.citations),
      expiresAt: exercise.expiresAt,
      items: exercise.items.map((item) => ({
        id: item.id,
        position: item.position,
        prompt: item.prompt,
        choices: definitionItemSchema.shape.choices.parse(item.choices),
        answerKey: definitionItemSchema.shape.answerKey.parse(item.answerKey),
        gradingRubric: definitionItemSchema.shape.gradingRubric.parse(
          item.gradingRubric,
        ),
        maxScore: item.maxScore,
        citations: z.array(toolCitationSchema).parse(item.citations),
        targets: item.targets.map((target) =>
          targetSchema.parse({
            targetType: target.targetType,
            targetKey: target.targetKey,
            ...(target.wordId ? { wordId: target.wordId } : {}),
            weight: Number(target.weight),
          }),
        ),
      })),
    };
  }

  async createReady(input: StoredReadyExercise) {
    await this.prisma.exercise.create({
      data: {
        id: input.id,
        userId: input.subjectId,
        conversationId: input.conversationId,
        requestId: input.requestId,
        type: input.type,
        status: 'READY',
        cefrDifficulty: input.difficulty,
        instructions: input.instructions,
        personalizationReason: input.personalizationReason,
        schemaVersion: input.schemaVersion,
        citations: input.citations,
        expiresAt: input.expiresAt,
        items: {
          create: input.items.map((item) => ({
            id: item.id,
            position: item.position,
            prompt: item.prompt,
            choices: item.choices ?? Prisma.JsonNull,
            answerKey: item.answerKey,
            gradingRubric: item.gradingRubric,
            maxScore: item.maxScore,
            citations: item.citations,
            targets: {
              create: item.targets.map((target) => ({
                targetType: target.targetType,
                targetKey: target.targetKey,
                wordId: target.wordId,
                weight: target.weight,
              })),
            },
          })),
        },
      },
    });
    return (await this.findReadyByRequest(input.requestId))!;
  }
}

function targetKey(target: { targetType: string; targetKey: string }) {
  return `${target.targetType}:${target.targetKey}`;
}

function publicProjection(exercise: StoredReadyExercise): CreateExerciseOutput {
  return createExerciseOutputSchema.parse({
    schemaVersion: COACH_TOOL_SCHEMA_VERSION,
    ok: true,
    exerciseId: exercise.id,
    type: exercise.type,
    difficulty: exercise.difficulty,
    instructions: exercise.instructions,
    personalizationReason: exercise.personalizationReason,
    items: exercise.items.map((item) => ({
      itemId: item.id,
      position: item.position,
      prompt: item.prompt,
      choices: item.choices,
      maxScore: item.maxScore,
      citations: item.citations,
    })),
    citations: exercise.citations,
    expiresAt: exercise.expiresAt.toISOString(),
  });
}

@Injectable()
export class ExerciseService {
  constructor(
    private readonly repository: ExerciseRepository,
    private readonly createExerciseId: () => string = () =>
      `exercise_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    private readonly createItemId: () => string = () =>
      `item_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createReady(input: {
    subjectId: string;
    conversationId: string;
    requestId: string;
    definition: unknown;
    allowedTargetRefs: Array<{
      targetType: 'WORD' | 'ERROR_TYPE';
      targetKey: string;
    }>;
    allowedMaterialSourceIds: string[];
  }): Promise<CreateExerciseOutput> {
    const existing = await this.repository.findReadyByRequest(input.requestId);
    if (existing) {
      if (existing.subjectId !== input.subjectId) throw ownedResourceNotFound();
      return publicProjection(existing);
    }
    if (
      this.repository.isOwnedRequestScope &&
      !(await this.repository.isOwnedRequestScope(
        input.subjectId,
        input.conversationId,
        input.requestId,
      ))
    ) {
      throw ownedResourceNotFound();
    }
    const parsed = exerciseDefinitionSchema.safeParse(input.definition);
    const allowedTargets = new Set(input.allowedTargetRefs.map(targetKey));
    const allowedSources = new Set(input.allowedMaterialSourceIds);
    if (
      !parsed.success ||
      allowedSources.size === 0 ||
      parsed.data.items.some(
        (item) =>
          item.targets.some(
            (target) => !allowedTargets.has(targetKey(target)),
          ) ||
          item.citations.some(
            (citation) => !allowedSources.has(citation.sourceId),
          ),
      )
    ) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '练习内容未通过业务校验',
        400,
      );
    }
    const citations = [
      ...new Map(
        parsed.data.items
          .flatMap((item) => item.citations)
          .map((citation) => [citation.sourceId, citation]),
      ).values(),
    ];
    const created = await this.repository.createReady({
      id: this.createExerciseId(),
      subjectId: input.subjectId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      type: parsed.data.type,
      difficulty: parsed.data.difficulty,
      instructions: parsed.data.instructions,
      personalizationReason: parsed.data.personalizationReason,
      schemaVersion: COACH_TOOL_SCHEMA_VERSION,
      citations,
      expiresAt: new Date(this.now().getTime() + 24 * 60 * 60 * 1000),
      items: parsed.data.items.map((item, index) => ({
        ...item,
        id: this.createItemId(),
        position: index + 1,
      })),
    });
    return publicProjection(created);
  }
}
