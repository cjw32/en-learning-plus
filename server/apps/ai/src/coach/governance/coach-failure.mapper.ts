export type CoachFailureCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'SCHEMA_INVALID'
  | 'DATA_NOT_AVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'TOOL_TIMEOUT'
  | 'REQUEST_TIMEOUT'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STATE_CONFLICT'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export type CoachSaveStatus =
  | 'NOT_STARTED'
  | 'NOT_SAVED'
  | 'SAVED_ONCE'
  | 'UNKNOWN_RECONCILED';

export type CoachFailure = Readonly<{
  code: CoachFailureCode;
  retryable: boolean;
  message: string;
  saveStatus: CoachSaveStatus;
}>;

const policies: Record<
  CoachFailureCode,
  { retryable: boolean; message: string }
> = {
  UNAUTHENTICATED: { retryable: false, message: '请登录后再使用 Coach。' },
  FORBIDDEN: { retryable: false, message: '学习资源不存在或不可访问。' },
  VALIDATION_FAILED: {
    retryable: false,
    message: '请求参数无效，请检查后重试。',
  },
  SCHEMA_INVALID: {
    retryable: true,
    message: 'Coach 未生成可靠格式，请安全重试。',
  },
  DATA_NOT_AVAILABLE: {
    retryable: true,
    message: '学习资料暂时不可用，请稍后重试。',
  },
  MODEL_UNAVAILABLE: {
    retryable: true,
    message: 'AI 模型暂时不可用，请稍后重试。',
  },
  TOOL_TIMEOUT: { retryable: true, message: '学习工具响应超时，请安全重试。' },
  REQUEST_TIMEOUT: { retryable: true, message: '本次请求已超时，请安全重试。' },
  BUDGET_EXCEEDED: { retryable: false, message: '本次请求已达到预算上限。' },
  RATE_LIMITED: { retryable: true, message: '请求过于频繁，请稍后再试。' },
  IDEMPOTENCY_CONFLICT: { retryable: false, message: '重复请求内容不一致。' },
  STATE_CONFLICT: { retryable: false, message: '当前学习状态不允许此操作。' },
  CANCELLED: { retryable: true, message: '请求已取消。' },
  INTERNAL_ERROR: {
    retryable: true,
    message: 'Coach 暂时不可用，请稍后重试。',
  },
};

export function mapCoachFailure(
  error: unknown,
  saveStatus: CoachSaveStatus = 'NOT_STARTED',
): CoachFailure {
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'INTERNAL_ERROR';
  const code = (
    rawCode in policies ? rawCode : 'INTERNAL_ERROR'
  ) as CoachFailureCode;
  return Object.freeze({ code, ...policies[code], saveStatus });
}
