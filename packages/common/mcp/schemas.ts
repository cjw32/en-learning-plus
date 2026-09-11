import { z } from "zod";
import { mcpSafeErrorSchema } from "./errors";
import {
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  type McpSupportedProtocolVersion,
} from "./protocol-versions";

export const MCP_SCHEMA_VERSION = "en-learning.mcp.v1" as const;

const uniqueArray = <T extends z.ZodType>(
  item: T,
  maximum: number,
  minimum = 0,
) =>
  z
    .array(item)
    .min(minimum)
    .max(maximum)
    .refine(
      (items) =>
        new Set(items.map((value) => JSON.stringify(value))).size ===
        items.length,
      {
        message: "items must be unique",
      },
    );

export const mcpSchemaVersionSchema = z.literal(MCP_SCHEMA_VERSION);
export const mcpTraceIdSchema = z.string().min(10).max(128);
export const mcpIsoDateTimeSchema = z.iso.datetime({ offset: true });
export const mcpIsoDateSchema = z.iso.date();
export const mcpCefrSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const mcpDifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export const mcpScopeSchema = z.enum([
  "learning:read",
  "quiz:create",
  "answer:submit",
]);
export const mcpOpaqueCursorSchema = z
  .string()
  .min(24)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const mcpIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const mcpPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    cursor: mcpOpaqueCursorSchema.optional(),
  })
  .strict();

export const mcpInitializeInputSchema = z
  .object({
    protocolVersion: z.enum(MCP_SUPPORTED_PROTOCOL_VERSIONS),
    capabilities: z.object({}).passthrough(),
    clientInfo: z
      .object({
        name: z.string().min(1).max(120),
        version: z.string().min(1).max(64),
      })
      .strict(),
  })
  .strict();

export const mcpContentMetaSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    contentVersion: z.string().min(1).max(128),
    updatedAt: mcpIsoDateTimeSchema,
    truncated: z.boolean(),
    nextCursor: mcpOpaqueCursorSchema.nullable().optional(),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpCitationSchema = z
  .object({
    citationId: z.string().regex(/^cit_[A-Za-z0-9_-]{10,48}$/),
    source: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    excerpt: z.string().max(2_000).optional(),
    contentVersion: z.string().min(1).max(128),
    accessScope: z.enum(["PUBLIC", "OWNED_COURSE", "PRIVATE_OWNER"]),
    status: z.literal("active"),
  })
  .strict();

export const mcpCapabilityDescriptorSchema = z
  .object({
    type: z.enum(["resource", "resourceTemplate", "tool", "prompt"]),
    name: z.string().min(1).max(256),
    version: mcpSchemaVersionSchema,
    description: z.string().min(1).max(500),
    requiredScopes: uniqueArray(mcpScopeSchema, 3, 1),
    effect: z.enum([
      "read",
      "create_exercise",
      "write_learning_progress",
      "prompt_only",
    ]),
    idempotency: z.enum(["safe_repeat", "required", "not_applicable"]),
    confirmation: z.enum(["none", "url_elicitation_required"]),
    maxResultBytes: z
      .number()
      .int()
      .min(1)
      .max(256 * 1024)
      .optional(),
    deadlineMs: z.number().int().min(1).max(30_000).optional(),
  })
  .strict();

export const mcpCapabilityManifestSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    protocolVersion: z.enum(MCP_SUPPORTED_PROTOCOL_VERSIONS),
    manifestVersion: z.string().min(1).max(128),
    capabilities: z.array(mcpCapabilityDescriptorSchema).max(14),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpWordSummarySchema = z
  .object({
    wordId: mcpIdentifierSchema.max(64),
    word: z.string().min(1).max(100),
    definition: z.string().max(4_000).nullable().optional(),
    translation: z.string().max(4_000).nullable().optional(),
    partOfSpeech: z.string().max(64).nullable().optional(),
    phonetic: z.string().max(128).nullable().optional(),
    cefr: mcpCefrSchema.nullable().optional(),
    availability: z.enum(["available", "partially_available"]),
    contentVersion: z.string().min(1).max(128),
  })
  .strict();

export const mcpWordResourceSchema = z
  .object({
    kind: z.literal("word"),
    uri: z.string().regex(/^en-learning:\/\/words\/[A-Za-z0-9_-]{1,64}$/),
    meta: mcpContentMetaSchema,
    word: mcpWordSummarySchema,
    forms: z.array(z.string().min(1).max(100)).max(20).optional(),
    examples: z.array(z.string().min(1).max(1_000)).max(10),
    source: mcpCitationSchema,
  })
  .strict();

export const mcpCourseMaterialResourceSchema = z
  .object({
    kind: z.literal("course_material"),
    uri: z
      .string()
      .regex(
        /^en-learning:\/\/courses\/[A-Za-z0-9_-]{1,64}\/materials\/[A-Za-z0-9_-]{1,128}$/,
      ),
    meta: mcpContentMetaSchema,
    courseId: mcpIdentifierSchema.max(64),
    materialId: mcpIdentifierSchema,
    title: z.string().min(1).max(300),
    summary: z.string().min(1).max(8_000),
    locator: z.string().max(500).nullable(),
    source: mcpCitationSchema,
  })
  .strict();

export const mcpDueWordSchema = z
  .object({
    wordId: mcpIdentifierSchema.max(64),
    word: z.string().min(1).max(100),
    reviewState: z.enum(["LEARNING", "REVIEW", "MASTERED"]),
    dueAt: mcpIsoDateTimeSchema,
    priority: z.number().int().min(1).max(100),
    reason: z.string().min(1).max(1_000),
  })
  .strict();

export const mcpReviewsResourceSchema = z
  .object({
    kind: z.literal("today_reviews"),
    uri: z.literal("en-learning://me/reviews/today"),
    meta: mcpContentMetaSchema,
    learningDate: mcpIsoDateSchema,
    timezone: z.string().min(1).max(64),
    totalDue: z.number().int().min(0),
    items: z.array(mcpDueWordSchema).max(50),
  })
  .strict();

export const mcpReportSchema = z
  .object({
    windowStart: mcpIsoDateSchema,
    windowEnd: mcpIsoDateSchema,
    attemptCount: z.number().int().min(0),
    averageScore: z.number().int().min(0).max(100).nullable(),
    reviewsDue: z.number().int().min(0),
    reviewsCompleted: z.number().int().min(0),
    learnedWordCount: z.number().int().min(0).optional(),
    dataCompleteness: z.enum(["complete", "partial", "insufficient"]),
    policyVersion: z.string().min(1).max(128),
  })
  .strict();

export const mcpReportResourceSchema = z
  .object({
    kind: z.literal("learning_report"),
    uri: z.literal("en-learning://me/reports/summary"),
    meta: mcpContentMetaSchema,
    report: mcpReportSchema,
  })
  .strict();

export const mcpWeaknessSchema = z
  .object({
    type: z.enum(["word", "error_type"]),
    key: z.string().min(1).max(128),
    label: z.string().min(1).max(300),
    count: z.number().int().min(1).optional(),
    lastSeenAt: mcpIsoDateTimeSchema.nullable().optional(),
    evidenceStatus: z.enum(["current", "stale", "insufficient"]),
  })
  .strict();

export const mcpWeaknessResourceSchema = z
  .object({
    kind: z.literal("weaknesses"),
    uri: z.literal("en-learning://me/weaknesses"),
    meta: mcpContentMetaSchema,
    dataCompleteness: z.enum(["complete", "partial", "insufficient"]),
    items: z.array(mcpWeaknessSchema).max(50),
  })
  .strict();

export const mcpResourceContentSchema = z.union([
  mcpWordResourceSchema,
  mcpCourseMaterialResourceSchema,
  mcpReviewsResourceSchema,
  mcpReportResourceSchema,
  mcpWeaknessResourceSchema,
]);

export const mcpRagCategorySchema = z.enum([
  "WORD_MEANING",
  "WORD_TRANSLATION",
  "WORD_PRONUNCIATION",
  "WORD_FORM",
  "WORD_USAGE",
  "COLLOCATION",
  "EXAMPLE_SENTENCE",
  "GRAMMAR_RULE",
  "GRAMMAR_EXCEPTION",
  "COURSE_LESSON",
  "EXERCISE_KNOWLEDGE",
  "USER_ERROR",
  "LEARNING_SUMMARY",
]);
export const mcpExerciseTypeSchema = z.enum([
  "MULTIPLE_CHOICE",
  "FILL_IN_BLANK",
  "TRANSLATION",
  "SHORT_ANSWER",
]);

export const mcpSearchWordsInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    query: z.string().min(1).max(200),
    cefr: mcpCefrSchema.optional(),
    courseId: mcpIdentifierSchema.max(64).optional(),
    limit: z.number().int().min(1).max(50).default(10),
    cursor: mcpOpaqueCursorSchema.optional(),
  })
  .strict();

export const mcpGetDueWordsInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    learningDate: mcpIsoDateSchema,
    timezone: z.string().min(1).max(64),
    courseId: mcpIdentifierSchema.max(64).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: mcpOpaqueCursorSchema.optional(),
  })
  .strict();

export const mcpSearchMaterialsInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    query: z.string().min(1).max(1_000),
    categories: uniqueArray(mcpRagCategorySchema, 13, 1),
    levels: uniqueArray(mcpCefrSchema, 6).optional(),
    courseIds: uniqueArray(mcpIdentifierSchema.max(64), 20).optional(),
    wordIds: uniqueArray(mcpIdentifierSchema.max(64), 50).optional(),
    topK: z.number().int().min(1).max(20).default(8),
    minimumRelevance: z.number().min(0).max(1).optional(),
  })
  .strict();

export const mcpCreateQuizInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    types: uniqueArray(mcpExerciseTypeSchema, 4, 1),
    count: z.number().int().min(1).max(20),
    difficulty: mcpDifficultySchema,
    wordIds: uniqueArray(mcpIdentifierSchema.max(64), 50).optional(),
    knowledgeCategories: uniqueArray(mcpRagCategorySchema, 13).optional(),
    scenario: z.string().max(1_000).optional(),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();

export const mcpAnswerSchema = z
  .object({
    itemId: mcpIdentifierSchema.max(64),
    value: z.union([
      z.string().max(4_000),
      z.array(z.string().max(1_000)).min(1).max(20),
    ]),
  })
  .strict();

export const mcpSubmitAnswerInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    exerciseId: mcpIdentifierSchema.min(10).max(64),
    exerciseVersion: z.string().min(1).max(128),
    answers: z.array(mcpAnswerSchema).min(1).max(50),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();

export const mcpGetLearningReportInputSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    from: mcpIsoDateSchema.optional(),
    to: mcpIsoDateSchema.optional(),
    dimensions: uniqueArray(
      z.enum(["progress", "review", "performance", "weaknesses", "errors"]),
      5,
      1,
    ).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

const toolInvocation = <N extends string, T extends z.ZodType>(
  name: N,
  input: T,
) => z.object({ name: z.literal(name), input }).strict();

export const mcpToolInvocationSchema = z.union([
  toolInvocation("search_words", mcpSearchWordsInputSchema),
  toolInvocation("get_due_words", mcpGetDueWordsInputSchema),
  toolInvocation("search_learning_materials", mcpSearchMaterialsInputSchema),
  toolInvocation("create_quiz", mcpCreateQuizInputSchema),
  toolInvocation("submit_answer", mcpSubmitAnswerInputSchema),
  toolInvocation("get_learning_report", mcpGetLearningReportInputSchema),
]);

export const mcpSearchWordsSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    query: z.string().min(1).max(200),
    items: z.array(mcpWordSummarySchema).max(50),
    nextCursor: mcpOpaqueCursorSchema.nullable(),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpGetDueWordsSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    asOf: mcpIsoDateTimeSchema,
    totalDue: z.number().int().min(0),
    items: z.array(mcpDueWordSchema).max(100),
    nextCursor: mcpOpaqueCursorSchema.nullable(),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpMaterialResultSchema = z
  .object({
    resultId: z.string().min(10).max(64),
    title: z.string().min(1).max(300),
    category: z.string().min(1).max(64),
    excerpt: z.string().min(1).max(2_000),
    rank: z.number().int().min(1).max(20),
    relevanceScore: z.number().min(0).max(1),
    contentVersion: z.string().min(1).max(128),
    citation: mcpCitationSchema,
  })
  .strict();

export const mcpSearchMaterialsSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    retrievalStatus: z.enum(["success", "insufficient"]),
    results: z.array(mcpMaterialResultSchema).max(20),
    conflicts: z
      .array(
        z
          .object({
            topic: z.string().min(1).max(300),
            resolution: z.enum([
              "resolved_by_version",
              "resolved_by_authority",
              "unresolved",
            ]),
          })
          .strict(),
      )
      .max(20),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpExerciseItemSchema = z
  .object({
    itemId: mcpIdentifierSchema.max(64),
    position: z.number().int().min(1).max(20),
    type: mcpExerciseTypeSchema,
    prompt: z.string().min(1).max(4_000),
    choices: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            text: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    maxScore: z.number().int().min(1).max(100),
  })
  .strict();

export const mcpCreateQuizSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    exerciseId: mcpIdentifierSchema.min(10).max(64),
    exerciseVersion: z.string().min(1).max(128),
    status: z.literal("ready"),
    instructions: z.string().min(1).max(2_000),
    personalizationReason: z.string().min(1).max(2_000),
    items: z.array(mcpExerciseItemSchema).min(1).max(20),
    citations: z.array(mcpCitationSchema).min(1).max(20),
    replayed: z.boolean(),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpConfirmationRequiredSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(false),
    status: z.enum(["confirmation_required", "confirmation_pending"]),
    expiresAt: mcpIsoDateTimeSchema,
    operationSummary: z.string().min(1).max(1_000),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpGradedItemSchema = z
  .object({
    itemId: mcpIdentifierSchema.max(64),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4_000),
    explanation: z.string().min(1).max(4_000),
    errorTypes: uniqueArray(z.string().max(64), 11),
  })
  .strict();

export const mcpLearningChangeSchema = z
  .object({
    targetType: z.string().max(64),
    targetKey: z.string().min(1).max(128),
    previousState: z.string().max(64),
    nextState: z.string().max(64),
    nextReviewAt: mcpIsoDateTimeSchema.nullable(),
  })
  .strict();

export const mcpSubmitAnswerSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    submissionId: z.string().min(10).max(64).nullable(),
    attemptId: z.string().min(10).max(64).nullable(),
    saveStatus: z.enum(["saved", "replayed", "not_saved"]),
    score: z.number().int().min(0).max(100),
    items: z.array(mcpGradedItemSchema).min(1).max(50),
    learningChanges: z.array(mcpLearningChangeSchema).max(50),
    saveFailure: z
      .object({
        code: z.enum([
          "CANCELLED",
          "TIMEOUT",
          "DEPENDENCY_UNAVAILABLE",
          "INTERNAL_ERROR",
        ]),
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
    traceId: mcpTraceIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.saveStatus === "not_saved") {
      if (value.submissionId !== null || value.attemptId !== null) {
        context.addIssue({
          code: "custom",
          message: "not_saved has no business IDs",
        });
      }
      if (value.learningChanges.length > 0 || !value.saveFailure) {
        context.addIssue({
          code: "custom",
          message: "not_saved requires one safe failure and no changes",
        });
      }
    } else if (value.submissionId === null || value.attemptId === null) {
      context.addIssue({
        code: "custom",
        message: "saved results require business IDs",
      });
    }
  });

export const mcpLearningReportSuccessSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    ok: z.literal(true),
    report: mcpReportSchema,
    weaknesses: z.array(mcpWeaknessSchema).max(50),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpToolResultSchema = z.union([
  mcpSearchWordsSuccessSchema,
  mcpGetDueWordsSuccessSchema,
  mcpSearchMaterialsSuccessSchema,
  mcpCreateQuizSuccessSchema,
  mcpConfirmationRequiredSchema,
  mcpSubmitAnswerSuccessSchema,
  mcpLearningReportSuccessSchema,
  mcpSafeErrorSchema,
]);

export const mcpEnglishInterviewArgsSchema = z
  .object({
    role: z.string().min(1).max(120),
    level: mcpCefrSchema.optional(),
    difficulty: mcpDifficultySchema.optional(),
    rounds: z.number().int().min(1).max(10).default(5),
    durationMinutes: z.number().int().min(5).max(60).default(20),
    feedbackEachRound: z.boolean().default(true),
  })
  .strict();

export const mcpBusinessEnglishArgsSchema = z
  .object({
    scenario: z.enum(["meeting", "email", "presentation", "negotiation"]),
    level: mcpCefrSchema.optional(),
    difficulty: mcpDifficultySchema.optional(),
    targetExpression: z.string().max(500).optional(),
  })
  .strict();

export const mcpVocabularyReviewArgsSchema = z
  .object({
    scope: z.enum(["due_today", "weak_words", "course"]).default("due_today"),
    courseId: mcpIdentifierSchema.max(64).optional(),
    types: uniqueArray(mcpExerciseTypeSchema, 4, 1).optional(),
    difficulty: mcpDifficultySchema.optional(),
    count: z.number().int().min(1).max(20).default(10),
  })
  .strict();

const promptRequest = <N extends string, T extends z.ZodType>(
  name: N,
  args: T,
) => z.object({ name: z.literal(name), arguments: args }).strict();

export const mcpPromptRequestSchema = z.union([
  promptRequest("english_interview", mcpEnglishInterviewArgsSchema),
  promptRequest("business_english", mcpBusinessEnglishArgsSchema),
  promptRequest("vocabulary_review", mcpVocabularyReviewArgsSchema),
]);

export const mcpPromptMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.string().min(1).max(12_000),
  })
  .strict();

export const mcpPromptResultSchema = z
  .object({
    schemaVersion: mcpSchemaVersionSchema,
    name: z.enum([
      "english_interview",
      "business_english",
      "vocabulary_review",
    ]),
    promptVersion: z.string().min(1).max(128),
    messages: z.array(mcpPromptMessageSchema).min(1).max(4),
    recommendedReadTools: uniqueArray(
      z.enum([
        "search_words",
        "get_due_words",
        "search_learning_materials",
        "get_learning_report",
      ]),
      4,
    ),
    writesRequireSeparateConfirmation: z.literal(true),
    traceId: mcpTraceIdSchema,
  })
  .strict();

export const mcpPublicCapabilityContentSchema = z.union([
  mcpCapabilityManifestSchema,
  mcpResourceContentSchema,
  mcpToolInvocationSchema,
  mcpToolResultSchema,
  mcpPromptRequestSchema,
  mcpPromptResultSchema,
]);

export type McpInitializeInput = z.infer<typeof mcpInitializeInputSchema>;
export type McpCapabilityManifest = z.infer<typeof mcpCapabilityManifestSchema>;
export type McpResourceContent = z.infer<typeof mcpResourceContentSchema>;
export type McpToolInvocation = z.infer<typeof mcpToolInvocationSchema>;
export type McpToolResult = z.infer<typeof mcpToolResultSchema>;
export type McpPromptRequest = z.infer<typeof mcpPromptRequestSchema>;
export type McpPromptResult = z.infer<typeof mcpPromptResultSchema>;
export type { McpSupportedProtocolVersion };
