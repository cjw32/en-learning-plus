export type LearningErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'STATE_CONFLICT'
  | 'DATA_NOT_AVAILABLE';

export type PublicLearningError = Readonly<{
  code: LearningErrorCode;
  message: string;
  retryable: boolean;
  statusCode: number;
}>;

export class LearningDomainError extends Error {
  constructor(
    readonly code: LearningErrorCode,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LearningDomainError';
  }

  toPublicError(): PublicLearningError {
    return Object.freeze({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      statusCode: this.statusCode,
    });
  }
}

export function ownedResourceNotFound(): LearningDomainError {
  return new LearningDomainError(
    'RESOURCE_NOT_FOUND',
    '学习资源不存在或不可访问',
    404,
  );
}

export function toPublicLearningError(error: unknown): PublicLearningError {
  if (error instanceof LearningDomainError) return error.toPublicError();
  return Object.freeze({
    code: 'DATA_NOT_AVAILABLE',
    message: '学习数据暂时不可用',
    retryable: true,
    statusCode: 503,
  });
}
