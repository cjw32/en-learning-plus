import { z } from "zod";

export const MCP_CONFIRMATION_SCHEMA_VERSION =
  "en-learning.mcp.confirmation.v1" as const;

export const mcpConfirmationSelectorSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const mcpConfirmationStatusSchema = z.enum([
  "pending",
  "confirmed",
  "rejected",
]);

export const mcpConfirmationInternalStateSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "CLAIMED",
  "CONSUMED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
]);

export const mcpConfirmationExerciseSummarySchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    itemCount: z.number().int().min(1).max(50),
    version: z.string().min(1).max(128),
  })
  .strict();

export const mcpConfirmationOperationSummarySchema = z
  .object({
    answerCount: z.number().int().min(1).max(50),
    willSaveAttempt: z.literal(true),
    willUpdateMastery: z.literal(true),
    willUpdateReviewSchedule: z.literal(true),
    notice: z.string().min(1).max(500).optional(),
  })
  .strict();

export const mcpConfirmationIntentSummarySchema = z
  .object({
    schemaVersion: z.literal(MCP_CONFIRMATION_SCHEMA_VERSION),
    toolName: z.literal("submit_answer"),
    exercise: mcpConfirmationExerciseSummarySchema,
    operationSummary: mcpConfirmationOperationSummarySchema,
    operationSummaryDigest: z.string().min(32).max(128),
  })
  .strict();

export const mcpConfirmationDecisionInputSchema = z
  .object({
    schemaVersion: z.literal(MCP_CONFIRMATION_SCHEMA_VERSION),
    decision: z.enum(["confirm", "reject"]),
    operationSummaryDigest: z.string().min(32).max(128),
  })
  .strict();

export const mcpConfirmationViewSchema = z
  .object({
    schemaVersion: z.literal(MCP_CONFIRMATION_SCHEMA_VERSION),
    status: mcpConfirmationStatusSchema,
    clientDisplayName: z.string().min(1).max(120),
    toolName: z.literal("submit_answer"),
    exercise: mcpConfirmationExerciseSummarySchema,
    operationSummary: mcpConfirmationOperationSummarySchema,
    operationSummaryDigest: z.string().min(32).max(128),
    expiresAt: z.iso.datetime({ offset: true }),
    retryInstruction: z.string().min(1).max(500),
  })
  .strict();

export const mcpConfirmationDecisionResultSchema = z
  .object({
    schemaVersion: z.literal(MCP_CONFIRMATION_SCHEMA_VERSION),
    status: z.enum(["confirmed", "rejected"]),
    writeExecuted: z.literal(false),
    nextAction: z.enum(["retry_original_mcp_call", "no_action"]),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.status === "confirmed" ? "retry_original_mcp_call" : "no_action";
    if (value.nextAction !== expected) {
      context.addIssue({
        code: "custom",
        path: ["nextAction"],
        message: "nextAction does not match the confirmation status",
      });
    }
  });

export const mcpConfirmationSafeErrorSchema = z
  .object({
    schemaVersion: z.literal(MCP_CONFIRMATION_SCHEMA_VERSION),
    code: z.enum([
      "UNAUTHENTICATED",
      "RESOURCE_NOT_FOUND",
      "VALIDATION_FAILED",
      "CONFIRMATION_EXPIRED",
      "CONFIRMATION_STATE_CONFLICT",
    ]),
    message: z.string().min(1).max(300),
  })
  .strict();

export const mcpModernConfirmationElicitationSchema = z
  .object({
    resultType: z.literal("input_required"),
    inputRequests: z
      .object({
        confirm_submission: z
          .object({
            method: z.literal("elicitation/create"),
            params: z
              .object({
                mode: z.literal("url"),
                url: z.url(),
                message: z.string().min(1).max(300),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    requestState: z.string().min(16).max(2_048),
  })
  .strict();

export const mcpLegacyConfirmationElicitationSchema = z
  .object({
    code: z.literal(-32042),
    message: z.string().min(1).max(300),
    data: z
      .object({
        elicitations: z
          .array(
            z
              .object({
                mode: z.literal("url"),
                elicitationId: z.string().min(10).max(128),
                url: z.url(),
                message: z.string().min(1).max(300),
              })
              .strict(),
          )
          .length(1),
      })
      .strict(),
  })
  .strict();

export type McpConfirmationDecisionInput = z.infer<
  typeof mcpConfirmationDecisionInputSchema
>;
export type McpConfirmationView = z.infer<typeof mcpConfirmationViewSchema>;
export type McpConfirmationDecisionResult = z.infer<
  typeof mcpConfirmationDecisionResultSchema
>;
export type McpConfirmationSafeError = z.infer<
  typeof mcpConfirmationSafeErrorSchema
>;

const WRITE_CONFIRMATION_OPENAPI = `openapi: 3.1.0
info:
  title: English Learning MCP Write Confirmation
  version: en-learning.mcp.confirmation.v1
  description: >-
    Public contract for the implemented project-owned browser confirmation flow. These
    endpoints use the existing Web user authentication, never the MCP access
    token. Confirming or rejecting does not execute the learning write; the
    original submit_answer call must be retried.
servers:
  - url: https://example.invalid
    description: Approval-gated HTTPS deployment input; runtime remains default-off.
tags:
  - name: MCP write confirmation
paths:
  /ai/v1/mcp/confirmations/{selector}:
    get:
      tags: [MCP write confirmation]
      operationId: getMcpWriteConfirmation
      summary: Read the exact operation summary for the current Web user
      security:
        - WebBearer: []
      parameters:
        - $ref: '#/components/parameters/Selector'
      responses:
        '200':
          description: Pending or already-decided confirmation owned by this user
          headers:
            Cache-Control:
              schema:
                type: string
                const: private, no-store
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConfirmationView'
        '401':
          $ref: '#/components/responses/Unauthenticated'
        '404':
          $ref: '#/components/responses/NotFound'
        '410':
          $ref: '#/components/responses/Expired'
    post:
      tags: [MCP write confirmation]
      operationId: decideMcpWriteConfirmation
      summary: Confirm or reject the displayed operation for the current Web user
      description: >-
        Performs only the PENDING to CONFIRMED or PENDING to REJECTED transition.
        It never grades an answer, writes an attempt, or updates mastery/review.
      security:
        - WebBearer: []
      parameters:
        - $ref: '#/components/parameters/Selector'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [schemaVersion, decision, operationSummaryDigest]
              properties:
                schemaVersion:
                  type: string
                  const: en-learning.mcp.confirmation.v1
                decision:
                  type: string
                  enum: [confirm, reject]
                operationSummaryDigest:
                  type: string
                  minLength: 32
                  maxLength: 128
      responses:
        '200':
          description: Decision recorded; retry the original MCP call if confirmed
          headers:
            Cache-Control:
              schema:
                type: string
                const: private, no-store
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConfirmationDecisionResult'
        '400':
          $ref: '#/components/responses/InvalidRequest'
        '401':
          $ref: '#/components/responses/Unauthenticated'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          description: Already decided, claimed, consumed, or conflicting decision
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SafeError'
        '410':
          $ref: '#/components/responses/Expired'
components:
  securitySchemes:
    WebBearer:
      type: http
      scheme: bearer
      bearerFormat: Existing en-learning-plus Web access token
      description: >-
        Existing Web authentication used only to prove the currently logged-in
        local user. It must never be accepted at the MCP Streamable HTTP endpoint.
  parameters:
    Selector:
      name: selector
      in: path
      required: true
      description: >-
        High-entropy opaque random reference. It contains no user, exercise,
        answer, token, or pre-authenticated authority and is stored server-side
        only as an HMAC.
      schema:
        type: string
        minLength: 32
        maxLength: 128
        pattern: '^[A-Za-z0-9_-]+$'
  schemas:
    ConfirmationView:
      type: object
      additionalProperties: false
      required:
        - schemaVersion
        - status
        - clientDisplayName
        - toolName
        - exercise
        - operationSummary
        - operationSummaryDigest
        - expiresAt
        - retryInstruction
      properties:
        schemaVersion:
          type: string
          const: en-learning.mcp.confirmation.v1
        status:
          type: string
          enum: [pending, confirmed, rejected]
        clientDisplayName:
          type: string
          minLength: 1
          maxLength: 120
          description: Sanitized display only; OAuth client ID remains authoritative.
        toolName:
          type: string
          const: submit_answer
        exercise:
          type: object
          additionalProperties: false
          required: [itemCount, version]
          properties:
            title:
              type: [string, 'null']
              maxLength: 200
            itemCount:
              type: integer
              minimum: 1
              maximum: 50
            version:
              type: string
              minLength: 1
              maxLength: 128
        operationSummary:
          type: object
          additionalProperties: false
          required: [answerCount, willSaveAttempt, willUpdateMastery, willUpdateReviewSchedule]
          properties:
            answerCount:
              type: integer
              minimum: 1
              maximum: 50
            willSaveAttempt:
              type: boolean
              const: true
            willUpdateMastery:
              type: boolean
              const: true
            willUpdateReviewSchedule:
              type: boolean
              const: true
            notice:
              type: string
              minLength: 1
              maxLength: 500
        operationSummaryDigest:
          type: string
          minLength: 32
          maxLength: 128
        expiresAt:
          type: string
          format: date-time
        retryInstruction:
          type: string
          minLength: 1
          maxLength: 500
    ConfirmationDecisionResult:
      type: object
      additionalProperties: false
      required: [schemaVersion, status, writeExecuted, nextAction]
      properties:
        schemaVersion:
          type: string
          const: en-learning.mcp.confirmation.v1
        status:
          type: string
          enum: [confirmed, rejected]
        writeExecuted:
          type: boolean
          const: false
        nextAction:
          type: string
          enum: [retry_original_mcp_call, no_action]
    SafeError:
      type: object
      additionalProperties: false
      required: [schemaVersion, code, message]
      properties:
        schemaVersion:
          type: string
          const: en-learning.mcp.confirmation.v1
        code:
          type: string
          enum:
            - UNAUTHENTICATED
            - RESOURCE_NOT_FOUND
            - VALIDATION_FAILED
            - CONFIRMATION_EXPIRED
            - CONFIRMATION_STATE_CONFLICT
        message:
          type: string
          minLength: 1
          maxLength: 300
  responses:
    Unauthenticated:
      description: Existing Web authentication missing, invalid, or not the mapped user
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SafeError'
    NotFound:
      description: Missing or not owned; response does not distinguish the reason
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SafeError'
    Expired:
      description: Confirmation exceeded its five-minute lifetime
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SafeError'
    InvalidRequest:
      description: Strict request schema or displayed-summary digest mismatch
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SafeError'
`;

export function renderMcpWriteConfirmationOpenApi(): string {
  return WRITE_CONFIRMATION_OPENAPI;
}
