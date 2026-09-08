import { Injectable } from '@nestjs/common';
import {
  citationSchema,
  errorTypeSchema,
  type Citation,
  type ErrorType,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import {
  buildAnswerPrompt,
  type CoachAnswerPromptInput,
} from '../prompts/answer.prompt';
import { buildClassifyIntentPrompt } from '../prompts/classify-intent.prompt';
import { buildCorrectionPrompt } from '../prompts/correction.prompt';
import {
  buildGradeAnswerPrompt,
  subjectiveGradeModelSchema,
} from '../prompts/grade-answer.prompt';
import type { SubjectiveGrader } from '@libs/learning';

const coachIntentModelOutputSchema = z
  .object({
    intent: z.enum([
      'ANSWER',
      'CORRECTION',
      'CREATE_EXERCISE',
      'GRADE_ANSWER',
      'REVIEW_RECOMMENDATION',
      'UNKNOWN',
    ]),
  })
  .strict();

export const coachAnswerModelOutputSchema = z
  .object({
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(12000),
    examples: z.array(z.string().min(1).max(2000)).max(8),
    errorTypes: z.array(errorTypeSchema).max(11),
    citations: z.array(citationSchema).max(20),
  })
  .strict();

export type CoachAnswerModelOutput = Readonly<{
  correction: string;
  explanation: string;
  examples: string[];
  errorTypes: ErrorType[];
  citations: Citation[];
}>;

export type CoachStructuredInvocation = Readonly<{
  schemaName:
    | 'coach_intent_v1'
    | 'coach_answer_v1'
    | 'coach_exercise_v1'
    | 'coach_subjective_grade_v1'
    | 'coach_next_action_reason_v1';
  prompt: string;
  jsonSchema: unknown;
  signal?: AbortSignal;
  telemetry?: CoachModelTelemetry;
}>;

export type CoachModelTelemetry = Readonly<{
  onFirstOutput(): void;
  onUsage(input: { inputTokens: number; outputTokens: number }): void;
}>;

export interface CoachStructuredModel {
  invokeStructured(input: CoachStructuredInvocation): Promise<unknown>;
}

@Injectable()
export class CoachModelGateway {
  constructor(private readonly model: CoachStructuredModel) {}

  async classifyIntent(
    message: string,
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ) {
    const raw = await this.model.invokeStructured({
      schemaName: 'coach_intent_v1',
      prompt: buildClassifyIntentPrompt(message),
      jsonSchema: z.toJSONSchema(coachIntentModelOutputSchema),
      signal,
      telemetry,
    });
    return coachIntentModelOutputSchema.parse(raw).intent;
  }

  async generateAnswer(
    input: CoachAnswerPromptInput,
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ): Promise<CoachAnswerModelOutput> {
    return this.invokeAnswer(buildAnswerPrompt(input), signal, telemetry);
  }

  async generateCorrection(
    input: CoachAnswerPromptInput,
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ): Promise<CoachAnswerModelOutput> {
    return this.invokeAnswer(buildCorrectionPrompt(input), signal, telemetry);
  }

  async gradeSubjective(
    input: Parameters<SubjectiveGrader['evaluate']>[0],
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ) {
    const raw = await this.model.invokeStructured({
      schemaName: 'coach_subjective_grade_v1',
      prompt: buildGradeAnswerPrompt(input),
      jsonSchema: z.toJSONSchema(subjectiveGradeModelSchema),
      signal,
      telemetry,
    });
    return subjectiveGradeModelSchema.parse(raw);
  }

  private async invokeAnswer(
    prompt: string,
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ) {
    const raw = await this.model.invokeStructured({
      schemaName: 'coach_answer_v1',
      prompt,
      jsonSchema: z.toJSONSchema(coachAnswerModelOutputSchema),
      signal,
      telemetry,
    });
    return coachAnswerModelOutputSchema.parse(raw);
  }
}
