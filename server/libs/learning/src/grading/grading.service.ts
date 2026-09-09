import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  errorTypeSchema,
  exerciseTypeSchema,
  type ErrorType,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';
import {
  gradeObjectiveAnswer,
  qualityFromScore,
  type DeterministicGrade,
} from './deterministic-grader';

const answerSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    answer: z.union([
      z.string().trim().min(1).max(4000),
      z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    ]),
  })
  .strict();

const subjectiveEvaluationSchema = z
  .object({
    scoreRatio: z.number().min(0).max(1),
    isCorrect: z.boolean(),
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(4000),
    errorTypes: z.array(errorTypeSchema).max(11),
    examples: z.array(z.string().min(1).max(2000)).max(8),
  })
  .strict();

export type GradableExerciseItem = {
  id: string;
  position: number;
  prompt: string;
  choices: Array<{ id: string; text: string }> | null;
  answerKey: Record<string, unknown>;
  gradingRubric: Record<string, unknown>;
  maxScore: number;
  citations: unknown[];
  targets: Array<{
    targetType: 'WORD' | 'ERROR_TYPE';
    targetKey: string;
    weight: number;
  }>;
};

export type GradableExercise = {
  id: string;
  version: string;
  type: z.infer<typeof exerciseTypeSchema>;
  citations: unknown[];
  items: GradableExerciseItem[];
};

export interface SubjectiveGrader {
  evaluate(input: {
    exerciseType: 'TRANSLATION' | 'SITUATIONAL_DIALOGUE';
    prompt: string;
    answer: string | string[];
    referenceAnswer: unknown;
    controlledRubric: Record<string, unknown>;
    maxScore: number;
  }): Promise<unknown>;
}

export type GradedItem = DeterministicGrade & {
  itemId: string;
  targetQualities: Array<{
    targetType: 'WORD' | 'ERROR_TYPE';
    targetKey: string;
    quality: number;
  }>;
};

export type GradingResult = {
  status: 'GRADED_VALID' | 'GRADING_FAILED';
  answerVersion: string | null;
  gradingHash: string | null;
  score: number | null;
  correction: string;
  explanation: string;
  examples: string[];
  errorTypes: ErrorType[];
  items: GradedItem[];
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function gradingDigest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function answerVersionFor(
  exerciseId: string,
  answers: Array<{ itemId: string; answer: string | string[] }>,
) {
  return gradingDigest({
    exerciseId,
    answers: [...answers].sort((left, right) =>
      left.itemId.localeCompare(right.itemId),
    ),
  });
}

function failed(): GradingResult {
  return {
    status: 'GRADING_FAILED',
    answerVersion: null,
    gradingHash: null,
    score: null,
    correction: '',
    explanation: '答案不完整或格式无效，无法可靠评分。',
    examples: [],
    errorTypes: [],
    items: [],
  };
}

@Injectable()
export class GradingService {
  constructor(private readonly subjective?: SubjectiveGrader) {}

  async grade(input: {
    exercise: GradableExercise;
    answers: unknown;
  }): Promise<GradingResult> {
    const parsed = z.array(answerSchema).min(1).max(50).safeParse(input.answers);
    if (!parsed.success || parsed.data.length !== input.exercise.items.length) {
      return failed();
    }
    const ids = parsed.data.map((answer) => answer.itemId);
    if (
      new Set(ids).size !== ids.length ||
      input.exercise.items.some((item) => !ids.includes(item.id))
    ) {
      return failed();
    }
    const answerVersion = answerVersionFor(input.exercise.id, parsed.data);
    const graded: GradedItem[] = [];
    for (const item of [...input.exercise.items].sort(
      (left, right) => left.position - right.position,
    )) {
      const answer = parsed.data.find((value) => value.itemId === item.id)!;
      let itemGrade: DeterministicGrade;
      if (
        input.exercise.type === 'MULTIPLE_CHOICE' ||
        input.exercise.type === 'FILL_BLANK'
      ) {
        const accepted = z
          .array(z.string().min(1).max(1000))
          .min(1)
          .safeParse(item.answerKey.accepted);
        if (!accepted.success) return failed();
        itemGrade = gradeObjectiveAnswer({
          answer: answer.answer,
          accepted: accepted.data,
          maxScore: item.maxScore,
          exerciseType: input.exercise.type,
        });
      } else {
        if (!this.subjective) return failed();
        const evaluated = subjectiveEvaluationSchema.safeParse(
          await this.subjective.evaluate({
            exerciseType: input.exercise.type,
            prompt: item.prompt,
            answer: answer.answer,
            referenceAnswer: item.answerKey.reference,
            controlledRubric: item.gradingRubric,
            maxScore: item.maxScore,
          }),
        );
        if (!evaluated.success) return failed();
        itemGrade = {
          ...evaluated.data,
          score: Math.round(evaluated.data.scoreRatio * item.maxScore),
        };
      }
      graded.push({
        itemId: item.id,
        ...itemGrade,
        targetQualities: item.targets.map((target) => ({
          targetType: target.targetType,
          targetKey: target.targetKey,
          quality: qualityFromScore(itemGrade.score, item.maxScore),
        })),
      });
    }
    const maxScore = input.exercise.items.reduce(
      (sum, item) => sum + item.maxScore,
      0,
    );
    const earned = graded.reduce((sum, item) => sum + item.score, 0);
    const score = maxScore > 0 ? Math.round((earned / maxScore) * 100) : 0;
    const errorTypes = [...new Set(graded.flatMap((item) => item.errorTypes))];
    const examples = [...new Set(graded.flatMap((item) => item.examples))].slice(
      0,
      8,
    );
    const resultWithoutHash = {
      status: 'GRADED_VALID' as const,
      answerVersion,
      score,
      correction: graded
        .map((item) => item.correction)
        .filter(Boolean)
        .join('\n'),
      explanation: graded.map((item) => item.explanation).join('\n'),
      examples,
      errorTypes,
      items: graded,
    };
    return {
      ...resultWithoutHash,
      gradingHash: gradingDigest({
        exerciseVersion: input.exercise.version,
        ...resultWithoutHash,
      }),
    };
  }
}

export type ValidGradingResult = GradingResult & {
  status: 'GRADED_VALID';
  answerVersion: string;
  gradingHash: string;
  score: number;
};

export type StoredValidSubmission = {
  id: string;
  subjectId: string;
  exerciseId: string;
  gradeRequestId: string;
  clientIdempotencyKey: string;
  answerVersion: string;
  gradingHash: string;
  status: 'GRADED_VALID' | 'SAVED';
  result: ValidGradingResult;
  citations: unknown[];
};

export interface GradingRepository {
  loadOwnedExercise(input: {
    subjectId: string;
    gradeRequestId: string;
    exerciseId: string;
    idempotencyKey: string;
  }): Promise<GradableExercise | null>;
  findOwnedSubmissionByKey(
    subjectId: string,
    idempotencyKey: string,
  ): Promise<StoredValidSubmission | null>;
  saveValidSubmission(input: {
    submissionId: string;
    subjectId: string;
    gradeRequestId: string;
    idempotencyKey: string;
    exercise: GradableExercise;
    answers: Array<{ itemId: string; answer: string | string[] }>;
    result: ValidGradingResult;
  }): Promise<StoredValidSubmission>;
}

const storedTargetQualitySchema = z
  .object({
    targetType: z.enum(['WORD', 'ERROR_TYPE']),
    targetKey: z.string().min(1).max(128),
    quality: z.number().int().min(0).max(5),
  })
  .strict();

const storedGradedItemSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    isCorrect: z.boolean(),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(4000),
    errorTypes: z.array(errorTypeSchema).max(11),
    examples: z.array(z.string().min(1).max(2000)).max(8),
    targetQualities: z.array(storedTargetQualitySchema).min(1).max(50),
  })
  .strict();

const storedValidResultSchema = z
  .object({
    status: z.literal('GRADED_VALID'),
    answerVersion: z.string().min(1).max(128),
    gradingHash: z.string().min(32).max(128),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(12000),
    examples: z.array(z.string().min(1).max(2000)).max(8),
    errorTypes: z.array(errorTypeSchema).max(11),
    items: z.array(storedGradedItemSchema).min(1).max(50),
  })
  .strict();

const storedCitationSchema = z
  .object({
    sourceId: z.string().min(1).max(128),
    materialType: z.enum(['word', 'course', 'grammar']),
    title: z.string().min(1).max(300),
    locator: z.string().max(500).nullable(),
    supports: z.string().min(1).max(1000),
    accessScope: z.enum(['PUBLIC', 'OWNED_COURSE']),
  })
  .strict();

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function storedSubmissionFromRow(row: {
  id: string;
  userId: string;
  exerciseId: string;
  gradeRequestId: string;
  clientIdempotencyKey: string;
  answerVersion: string;
  gradingHash: string | null;
  status: string;
  gradingResult: unknown;
  exercise: { citations: unknown };
}): StoredValidSubmission | null {
  const result = storedValidResultSchema.safeParse(row.gradingResult);
  const citations = z.array(storedCitationSchema).safeParse(
    row.exercise.citations,
  );
  if (
    !result.success ||
    !citations.success ||
    !row.gradingHash ||
    (row.status !== 'GRADED_VALID' && row.status !== 'SAVED')
  ) {
    return null;
  }
  return {
    id: row.id,
    subjectId: row.userId,
    exerciseId: row.exerciseId,
    gradeRequestId: row.gradeRequestId,
    clientIdempotencyKey: row.clientIdempotencyKey,
    answerVersion: row.answerVersion,
    gradingHash: row.gradingHash,
    status: row.status,
    result: result.data,
    citations: citations.data,
  };
}

@Injectable()
export class PrismaGradingRepository implements GradingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadOwnedExercise(input: {
    subjectId: string;
    gradeRequestId: string;
    exerciseId: string;
    idempotencyKey: string;
  }): Promise<GradableExercise | null> {
    const request = await this.prisma.coachRequest.findFirst({
      where: {
        id: input.gradeRequestId,
        userId: input.subjectId,
        clientRequestKey: input.idempotencyKey,
        inputType: 'EXERCISE_SUBMISSION',
        cancelRequestedAt: null,
      },
      select: { conversationId: true, exerciseId: true },
    });
    if (request?.exerciseId && request.exerciseId !== input.exerciseId) {
      return null;
    }
    if (!request) return null;
    const exercise = await this.prisma.exercise.findFirst({
      where: {
        id: input.exerciseId,
        userId: input.subjectId,
        conversationId: request.conversationId,
        status: { in: ['READY', 'GRADED'] },
        expiresAt: { gt: new Date() },
      },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { targets: true },
        },
      },
    });
    if (!exercise) return null;
    const citations = z.array(storedCitationSchema).safeParse(
      exercise.citations,
    );
    if (!citations.success) return null;
    const items = exercise.items.map((item) => ({
      id: item.id,
      position: item.position,
      prompt: item.prompt,
      choices: z
        .array(z.object({ id: z.string(), text: z.string() }).strict())
        .nullable()
        .parse(item.choices),
      answerKey: z.record(z.string(), z.json()).parse(item.answerKey),
      gradingRubric: z.record(z.string(), z.json()).parse(item.gradingRubric),
      maxScore: item.maxScore,
      citations: z.array(storedCitationSchema).parse(item.citations),
      targets: item.targets.map((target) => ({
        targetType: target.targetType,
        targetKey: target.targetKey,
        weight: Number(target.weight),
      })),
    }));
    return {
      id: exercise.id,
      version: gradingDigest({
        schemaVersion: exercise.schemaVersion,
        type: exercise.type,
        items,
      }),
      type: exercise.type,
      citations: citations.data,
      items,
    };
  }

  async findOwnedSubmissionByKey(
    subjectId: string,
    idempotencyKey: string,
  ) {
    const row = await this.prisma.exerciseSubmission.findFirst({
      where: { userId: subjectId, clientIdempotencyKey: idempotencyKey },
      include: { exercise: { select: { citations: true } } },
    });
    return row ? storedSubmissionFromRow(row) : null;
  }

  async saveValidSubmission(input: {
    submissionId: string;
    subjectId: string;
    gradeRequestId: string;
    idempotencyKey: string;
    exercise: GradableExercise;
    answers: Array<{ itemId: string; answer: string | string[] }>;
    result: ValidGradingResult;
  }): Promise<StoredValidSubmission> {
    const stored: StoredValidSubmission = {
      id: input.submissionId,
      subjectId: input.subjectId,
      exerciseId: input.exercise.id,
      gradeRequestId: input.gradeRequestId,
      clientIdempotencyKey: input.idempotencyKey,
      answerVersion: input.result.answerVersion,
      gradingHash: input.result.gradingHash,
      status: 'GRADED_VALID',
      result: input.result,
      citations: input.exercise.citations,
    };
    try {
      await this.prisma.$transaction(async (database) => {
        const request = await database.coachRequest.findFirst({
          where: {
            id: input.gradeRequestId,
            userId: input.subjectId,
            clientRequestKey: input.idempotencyKey,
            inputType: 'EXERCISE_SUBMISSION',
            cancelRequestedAt: null,
            OR: [{ exerciseId: null }, { exerciseId: input.exercise.id }],
          },
          select: { id: true },
        });
        const exercise = await database.exercise.findFirst({
          where: {
            id: input.exercise.id,
            userId: input.subjectId,
            status: { in: ['READY', 'GRADED'] },
          },
          select: { id: true },
        });
        if (!request || !exercise) throw ownedResourceNotFound();
        await database.coachRequest.update({
          where: { id: input.gradeRequestId },
          data: {
            exerciseId: input.exercise.id,
            answerVersion: input.result.answerVersion,
          },
        });
        await database.exerciseSubmission.create({
          data: {
            id: input.submissionId,
            userId: input.subjectId,
            exerciseId: input.exercise.id,
            gradeRequestId: input.gradeRequestId,
            answerVersion: input.result.answerVersion,
            clientIdempotencyKey: input.idempotencyKey,
            answers: jsonValue(input.answers),
            status: 'GRADED_VALID',
            score: input.result.score,
            gradingHash: input.result.gradingHash,
            resultSchemaVersion: 'coach.tool.v1',
            gradingResult: jsonValue(input.result),
            items: {
              create: input.result.items.map((item) => ({
                exerciseItemId: item.itemId,
                answer: jsonValue(
                  input.answers.find((answer) => answer.itemId === item.itemId)!
                    .answer,
                ),
                isCorrect: item.isCorrect,
                score: item.score,
                correction: item.correction,
                explanation: item.explanation,
                errorTypes: jsonValue(item.errorTypes),
                targetQualities: jsonValue(item.targetQualities),
              })),
            },
          },
        });
        await database.exercise.update({
          where: { id: input.exercise.id },
          data: { status: 'GRADED' },
        });
      });
      return stored;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.exerciseSubmission.findFirst({
          where: {
            userId: input.subjectId,
            OR: [
              { clientIdempotencyKey: input.idempotencyKey },
              {
                exerciseId: input.exercise.id,
                answerVersion: input.result.answerVersion,
              },
            ],
          },
          include: { exercise: { select: { citations: true } } },
        });
        const mapped = existing ? storedSubmissionFromRow(existing) : null;
        if (mapped) return mapped;
      }
      throw error;
    }
  }
}

@Injectable()
export class OwnedGradingService {
  constructor(
    private readonly repository: GradingRepository,
    private readonly grading: GradingService,
    private readonly createSubmissionId: () => string = () =>
      `submission_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  ) {}

  async gradeOwned(input: {
    subjectId: string;
    gradeRequestId: string;
    exerciseId: string;
    answers: Array<{ itemId: string; answer: string | string[] }>;
    idempotencyKey: string;
  }) {
    const parsedAnswers = z.array(answerSchema).min(1).max(50).safeParse(
      input.answers,
    );
    if (!parsedAnswers.success) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '答案格式无效',
        400,
      );
    }
    const answerVersion = answerVersionFor(
      input.exerciseId,
      parsedAnswers.data,
    );
    const existing = await this.repository.findOwnedSubmissionByKey(
      input.subjectId,
      input.idempotencyKey,
    );
    if (existing) {
      if (
        existing.exerciseId !== input.exerciseId ||
        existing.gradeRequestId !== input.gradeRequestId ||
        existing.answerVersion !== answerVersion
      ) {
        throw new LearningDomainError(
          'STATE_CONFLICT',
          '幂等键已绑定到其他作答',
          409,
        );
      }
      return this.publicResult(existing);
    }
    const exercise = await this.repository.loadOwnedExercise({
      subjectId: input.subjectId,
      gradeRequestId: input.gradeRequestId,
      exerciseId: input.exerciseId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!exercise) throw ownedResourceNotFound();
    const result = await this.grading.grade({
      exercise,
      answers: parsedAnswers.data,
    });
    if (
      result.status !== 'GRADED_VALID' ||
      result.answerVersion === null ||
      result.gradingHash === null ||
      result.score === null
    ) {
      return { status: 'GRADING_FAILED' as const };
    }
    const valid: ValidGradingResult = {
      ...result,
      status: 'GRADED_VALID',
      answerVersion: result.answerVersion,
      gradingHash: result.gradingHash,
      score: result.score,
    };
    const saved = await this.repository.saveValidSubmission({
      submissionId: this.createSubmissionId(),
      subjectId: input.subjectId,
      gradeRequestId: input.gradeRequestId,
      idempotencyKey: input.idempotencyKey,
      exercise,
      answers: parsedAnswers.data,
      result: valid,
    });
    if (
      saved.exerciseId !== input.exerciseId ||
      saved.answerVersion !== answerVersion
    ) {
      throw new LearningDomainError(
        'STATE_CONFLICT',
        '已存在的作答版本不一致',
        409,
      );
    }
    return this.publicResult(saved);
  }

  private publicResult(submission: StoredValidSubmission) {
    return {
      ...submission.result,
      submissionId: submission.id,
      citations: submission.citations,
    };
  }
}
