import {
  mcpCitationSchema,
  mcpCreateQuizSuccessSchema,
  mcpExerciseTypeSchema,
  type McpToolResult,
} from '@en/common/mcp';
import { validateMcpResult } from './mcp-result-validator';

type QuizResult = Extract<McpToolResult, { ok: true; status: 'ready' }>;
type QuizCitation = QuizResult['citations'][number];

export type McpQuizProjectionConstraints = Readonly<{
  traceId: string;
  requestedCount: number;
  requestedTypes: readonly string[];
  issuedCitations: readonly unknown[];
}>;

export class McpQuizResultProjectionError extends Error {
  readonly code = 'INTERNAL_ERROR' as const;

  constructor() {
    super('The generated quiz did not pass public projection validation.');
    this.name = 'McpQuizResultProjectionError';
  }
}

function sameCitation(left: QuizCitation, right: QuizCitation): boolean {
  return (
    left.citationId === right.citationId &&
    left.source === right.source &&
    left.title === right.title &&
    left.excerpt === right.excerpt &&
    left.contentVersion === right.contentVersion &&
    left.accessScope === right.accessScope &&
    left.status === right.status
  );
}

export class McpQuizResultProjector {
  project(
    untrustedResult: unknown,
    constraints: McpQuizProjectionConstraints,
  ): QuizResult {
    try {
      if (
        !constraints.traceId ||
        !Number.isSafeInteger(constraints.requestedCount) ||
        constraints.requestedCount < 1 ||
        constraints.requestedCount > 20 ||
        constraints.requestedTypes.length < 1 ||
        constraints.requestedTypes.length > 4
      ) {
        throw new McpQuizResultProjectionError();
      }
      const requestedTypes = constraints.requestedTypes.map((type) =>
        mcpExerciseTypeSchema.parse(type),
      );
      if (new Set(requestedTypes).size !== requestedTypes.length) {
        throw new McpQuizResultProjectionError();
      }
      const issued = constraints.issuedCitations.map((citation) =>
        mcpCitationSchema.parse(citation),
      );
      const issuedById = new Map(
        issued.map((citation) => [citation.citationId, citation]),
      );
      if (
        issued.length < 1 ||
        issued.length > 20 ||
        issuedById.size !== issued.length
      ) {
        throw new McpQuizResultProjectionError();
      }

      const result = validateMcpResult(
        mcpCreateQuizSuccessSchema,
        untrustedResult,
      );
      const positions = result.items.map(({ position }) => position);
      if (
        result.traceId !== constraints.traceId ||
        result.items.length !== constraints.requestedCount ||
        positions.some((position, index) => position !== index + 1) ||
        new Set(result.items.map(({ itemId }) => itemId)).size !==
          result.items.length ||
        result.items.some(({ type }) => !requestedTypes.includes(type)) ||
        new Set(result.citations.map(({ citationId }) => citationId)).size !==
          result.citations.length ||
        result.citations.some((citation) => {
          const trusted = issuedById.get(citation.citationId);
          return !trusted || !sameCitation(citation, trusted);
        })
      ) {
        throw new McpQuizResultProjectionError();
      }
      return result;
    } catch (error) {
      if (error instanceof McpQuizResultProjectionError) throw error;
      throw new McpQuizResultProjectionError();
    }
  }
}
