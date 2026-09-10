import { KnowledgeDomainError } from '../domain/knowledge.types';

export type EmbeddingRequest = Readonly<{
  texts: readonly string[];
  expectedDimensions: number;
  embeddingVersion: string;
  containsPrivateContent?: boolean;
  privateContentEligibility?: Readonly<{
    approved: true;
    purpose: 'PRIVATE_LEARNING_EMBEDDING';
    minimizationVersion: 'private-embedding-minimal.v1';
  }>;
  deadlineAt?: Date;
  signal?: AbortSignal;
}>;

export type EmbeddingUsage = Readonly<{
  inputTokens: number | null;
  totalTokens: number | null;
  estimated: boolean;
}>;

export type EmbeddingResponse = Readonly<{
  vectors: readonly (readonly number[])[];
  provider: string;
  model: string;
  dimensions: number;
  embeddingVersion: string;
  usage: EmbeddingUsage;
}>;

export interface EmbeddingGateway {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export class EmbeddingGatewayError extends KnowledgeDomainError {
  constructor(
    code:
      | 'EMBEDDING_PROVIDER_UNAPPROVED'
      | 'EMBEDDING_PRIVATE_CONTENT_UNAPPROVED'
      | 'EMBEDDING_REQUEST_INVALID'
      | 'EMBEDDING_RESPONSE_INVALID'
      | 'EMBEDDING_TIMEOUT'
      | 'EMBEDDING_RATE_LIMITED',
    retryable = false,
  ) {
    super(code, code, retryable);
    this.name = 'EmbeddingGatewayError';
  }
}

export function assertEmbeddingRequest(request: EmbeddingRequest): void {
  if (
    request.texts.length === 0 ||
    request.texts.some((text) => !text.trim()) ||
    !Number.isInteger(request.expectedDimensions) ||
    request.expectedDimensions <= 0 ||
    !request.embeddingVersion.trim() ||
    (request.deadlineAt !== undefined &&
      !Number.isFinite(request.deadlineAt.getTime()))
  ) {
    throw new EmbeddingGatewayError('EMBEDDING_REQUEST_INVALID');
  }
}

export function assertEmbeddingVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions: number,
): void {
  if (
    vectors.length !== expectedCount ||
    vectors.some(
      (vector) =>
        vector.length !== expectedDimensions ||
        vector.some((value) => !Number.isFinite(value)) ||
        vector.every((value) => value === 0),
    )
  ) {
    throw new EmbeddingGatewayError('EMBEDDING_RESPONSE_INVALID');
  }
}
