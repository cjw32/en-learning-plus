import { z } from '@en/common/coach/zod';
import type {
  PronunciationFailureCategory,
  PronunciationPublicErrorCode,
} from '@en/common/pronunciation';
import { PronunciationIdempotencyConflictError } from '../application/pronunciation.repository';

export type PronunciationPublicFailure = Readonly<{
  statusCode: number;
  code: PronunciationPublicErrorCode;
  category: PronunciationFailureCategory;
  message: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
  assessmentId: string | null;
  traceId: string | null;
}>;

export class PronunciationFailureError extends Error {
  constructor(
    readonly code: PronunciationPublicErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'PronunciationFailureError';
  }
}

const definitions: Readonly<
  Record<
    PronunciationPublicErrorCode,
    Readonly<{
      statusCode: number;
      category: PronunciationFailureCategory;
      message: string;
      retryable: boolean;
    }>
  >
> = Object.freeze({
  AUTH_REQUIRED: {
    statusCode: 401,
    category: 'AUTH',
    message: '请先登录后重试。',
    retryable: false,
  },
  TOKEN_INVALID: {
    statusCode: 401,
    category: 'AUTH',
    message: '登录状态已失效，请重新登录。',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    statusCode: 404,
    category: 'TARGET',
    message: '评测资源不存在或不可访问。',
    retryable: false,
  },
  VALIDATION_FAILED: {
    statusCode: 400,
    category: 'TARGET',
    message: '发音评测请求无效，请检查后重试。',
    retryable: false,
  },
  IDEMPOTENCY_CONFLICT: {
    statusCode: 409,
    category: 'GOVERNANCE',
    message: '重复请求与原请求内容不一致。',
    retryable: false,
  },
  STATE_CONFLICT: {
    statusCode: 409,
    category: 'GOVERNANCE',
    message: '评测状态已变化，请刷新后重试。',
    retryable: true,
  },
  RATE_LIMITED: {
    statusCode: 429,
    category: 'GOVERNANCE',
    message: '请求过于频繁，请稍后重试。',
    retryable: true,
  },
  CONCURRENCY_LIMITED: {
    statusCode: 429,
    category: 'GOVERNANCE',
    message: '已有评测正在处理中，请稍后重试。',
    retryable: true,
  },
  AUDIO_TOO_SHORT: {
    statusCode: 400,
    category: 'AUDIO',
    message: '录音时间太短，请重新录制。',
    retryable: true,
  },
  AUDIO_TOO_LONG: {
    statusCode: 400,
    category: 'AUDIO',
    message: '录音超过 30 秒，请缩短后重试。',
    retryable: true,
  },
  AUDIO_TOO_LARGE: {
    statusCode: 413,
    category: 'UPLOAD',
    message: '录音超过 8 MiB，请缩短后重试。',
    retryable: true,
  },
  AUDIO_UNSUPPORTED: {
    statusCode: 400,
    category: 'AUDIO',
    message: '当前录音格式不受支持，请重新录制。',
    retryable: true,
  },
  AUDIO_INVALID: {
    statusCode: 400,
    category: 'AUDIO',
    message: '无法安全读取录音，请重新录制。',
    retryable: true,
  },
  AUDIO_SILENT: {
    statusCode: 400,
    category: 'AUDIO',
    message: '没有检测到清晰语音，请重新录制。',
    retryable: true,
  },
  AUDIO_LOW_VOLUME: {
    statusCode: 400,
    category: 'AUDIO',
    message: '录音音量过低，请靠近麦克风重试。',
    retryable: true,
  },
  SPEECH_UNRECOGNIZABLE: {
    statusCode: 422,
    category: 'AUDIO',
    message: '暂时无法识别这段语音，请重新录制。',
    retryable: true,
  },
  SOURCE_UNAVAILABLE: {
    statusCode: 404,
    category: 'TARGET',
    message: '练习内容已不可用，请选择新的内容。',
    retryable: false,
  },
  FEATURE_DISABLED: {
    statusCode: 503,
    category: 'GOVERNANCE',
    message: '发音评测功能当前不可用。',
    retryable: false,
  },
  PROVIDER_NOT_APPROVED: {
    statusCode: 503,
    category: 'PROVIDER',
    message: '发音评测服务当前不可用。',
    retryable: false,
  },
  PROVIDER_TIMEOUT: {
    statusCode: 504,
    category: 'PROVIDER',
    message: '评测服务响应超时，请稍后重试。',
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    statusCode: 503,
    category: 'PROVIDER',
    message: '评测服务暂时不可用，请稍后重试。',
    retryable: true,
  },
  STORAGE_NOT_APPROVED: {
    statusCode: 503,
    category: 'UPLOAD',
    message: '录音上传当前不可用。',
    retryable: false,
  },
  PRICE_UNKNOWN: {
    statusCode: 503,
    category: 'GOVERNANCE',
    message: '评测计费信息尚未获批。',
    retryable: false,
  },
  BUDGET_NOT_APPROVED: {
    statusCode: 503,
    category: 'GOVERNANCE',
    message: '评测预算尚未获批。',
    retryable: false,
  },
  BUDGET_EXCEEDED: {
    statusCode: 429,
    category: 'GOVERNANCE',
    message: '评测额度已用完，请稍后再试。',
    retryable: true,
  },
  REQUEST_TIMEOUT: {
    statusCode: 504,
    category: 'GOVERNANCE',
    message: '评测处理超时，请重新发起。',
    retryable: true,
  },
  CANCELLED: {
    statusCode: 409,
    category: 'GOVERNANCE',
    message: '评测已取消。',
    retryable: false,
  },
  LEARNING_WRITE_FAILED: {
    statusCode: 503,
    category: 'LEARNING',
    message: '评测已完成，但学习进度暂未保存。',
    retryable: true,
  },
  INTERNAL_ERROR: {
    statusCode: 500,
    category: 'GOVERNANCE',
    message: '评测暂时不可用，请稍后重试。',
    retryable: true,
  },
});

const publicCodeSchema = z.enum(
  Object.keys(definitions) as [
    PronunciationPublicErrorCode,
    ...PronunciationPublicErrorCode[],
  ],
);

function codeFrom(error: unknown): PronunciationPublicErrorCode {
  if (error instanceof PronunciationIdempotencyConflictError) {
    return 'IDEMPOTENCY_CONFLICT';
  }
  if (error instanceof z.ZodError) return 'VALIDATION_FAILED';
  if (error && typeof error === 'object' && 'code' in error) {
    const parsed = publicCodeSchema.safeParse(
      (error as { code?: unknown }).code,
    );
    if (parsed.success) return parsed.data;
  }
  return 'INTERNAL_ERROR';
}

export function mapPronunciationFailure(
  error: unknown,
  context: Readonly<{
    assessmentId?: string | null;
    traceId?: string | null;
  }> = {},
): PronunciationPublicFailure {
  const code = codeFrom(error);
  const definition = definitions[code];
  const candidateRetryAfter =
    error && typeof error === 'object' && 'retryAfterSeconds' in error
      ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : null;
  const retryAfterSeconds =
    definition.retryable &&
    Number.isInteger(candidateRetryAfter) &&
    Number(candidateRetryAfter) > 0
      ? Math.min(Number(candidateRetryAfter), 86_400)
      : null;
  return Object.freeze({
    ...definition,
    code,
    retryAfterSeconds,
    assessmentId: context.assessmentId ?? null,
    traceId: context.traceId ?? null,
  });
}
