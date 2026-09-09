import {
  EmbeddingGateway,
  EmbeddingGatewayError,
  EmbeddingRequest,
  EmbeddingResponse,
  assertEmbeddingRequest,
  assertEmbeddingVectors,
} from '@libs/learning/knowledge/ingestion/embedding.gateway';

export type HttpEmbeddingGatewayConfig = Readonly<{
  approved: boolean;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  dimensions: number | null;
  embeddingVersion: string | null;
  allowPrivateContent: boolean;
  timeoutMs: number;
  maxRetries: number;
}>;

type ProviderResponse = {
  model?: unknown;
  data?: Array<{ index?: unknown; embedding?: unknown }>;
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
};

const placeholderValues = new Set(['', 'placeholder', 'replace-me', 'todo', 'tbd']);

function isApprovedText(value: string | null): value is string {
  return Boolean(value && !placeholderValues.has(value.trim().toLowerCase()));
}

function asUsage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

const forbiddenPrivatePayload =
  /\b(?:userId|subjectId|answerKey|gradingRubric|traceId|conversation|authorization|bearer)\b|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?:\+?\d[\d\s()-]{8,}\d)|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i;

function projectProviderTexts(request: EmbeddingRequest): readonly string[] {
  const texts = request.texts.map((text) =>
    text.normalize('NFKC').replace(/\s+/g, ' ').trim(),
  );
  if (texts.some((text) => !text || text.length > 8_000)) {
    throw new EmbeddingGatewayError('EMBEDDING_REQUEST_INVALID');
  }
  if (!request.containsPrivateContent) return texts;
  const eligibility = request.privateContentEligibility;
  if (
    !eligibility?.approved ||
    eligibility.purpose !== 'PRIVATE_LEARNING_EMBEDDING' ||
    eligibility.minimizationVersion !== 'private-embedding-minimal.v1' ||
    texts.some((text) => forbiddenPrivatePayload.test(text))
  ) {
    throw new EmbeddingGatewayError('EMBEDDING_PRIVATE_CONTENT_UNAPPROVED');
  }
  return texts;
}

export class HttpEmbeddingGateway implements EmbeddingGateway {
  constructor(
    private readonly config: HttpEmbeddingGatewayConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.config.approved) {
      throw new EmbeddingGatewayError('EMBEDDING_PROVIDER_UNAPPROVED');
    }
    if (
      !isApprovedText(this.config.endpoint) ||
      !isApprovedText(this.config.apiKey) ||
      !isApprovedText(this.config.model) ||
      !isApprovedText(this.config.embeddingVersion) ||
      !Number.isInteger(this.config.dimensions) ||
      Number(this.config.dimensions) <= 0 ||
      !Number.isInteger(this.config.timeoutMs) ||
      this.config.timeoutMs <= 0 ||
      !Number.isInteger(this.config.maxRetries) ||
      this.config.maxRetries < 0 ||
      this.config.maxRetries > 3
    ) {
      throw new EmbeddingGatewayError('EMBEDDING_PROVIDER_UNAPPROVED');
    }

    assertEmbeddingRequest(request);
    if (request.signal?.aborted) {
      throw new EmbeddingGatewayError('EMBEDDING_TIMEOUT');
    }
    if (request.containsPrivateContent && !this.config.allowPrivateContent) {
      throw new EmbeddingGatewayError(
        'EMBEDDING_PRIVATE_CONTENT_UNAPPROVED',
      );
    }
    const providerTexts = projectProviderTexts(request);
    if (
      request.expectedDimensions !== this.config.dimensions ||
      request.embeddingVersion !== this.config.embeddingVersion
    ) {
      throw new EmbeddingGatewayError('EMBEDDING_REQUEST_INVALID');
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const remainingMs = request.deadlineAt
        ? request.deadlineAt.getTime() - this.now()
        : this.config.timeoutMs;
      if (remainingMs <= 0) {
        throw new EmbeddingGatewayError('EMBEDDING_TIMEOUT');
      }
      try {
        return await this.send(
          request,
          providerTexts,
          Math.min(this.config.timeoutMs, remainingMs),
        );
      } catch (error) {
        if (
          !(error instanceof EmbeddingGatewayError) ||
          !error.retryable ||
          attempt >= this.config.maxRetries ||
          request.signal?.aborted
        ) {
          throw error;
        }
      }
    }
    throw new EmbeddingGatewayError('EMBEDDING_RESPONSE_INVALID');
  }

  private async send(
    request: EmbeddingRequest,
    providerTexts: readonly string[],
    timeoutMs: number,
  ): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImplementation(this.config.endpoint!, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: providerTexts,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new EmbeddingGatewayError(
          'EMBEDDING_TIMEOUT',
          !request.signal?.aborted,
        );
      }
      throw new EmbeddingGatewayError('EMBEDDING_RESPONSE_INVALID', true);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }

    if (response.status === 429) {
      throw new EmbeddingGatewayError('EMBEDDING_RATE_LIMITED', true);
    }
    if (!response.ok) {
      throw new EmbeddingGatewayError(
        'EMBEDDING_RESPONSE_INVALID',
        response.status >= 500,
      );
    }

    let body: ProviderResponse;
    try {
      body = (await response.json()) as ProviderResponse;
    } catch {
      throw new EmbeddingGatewayError('EMBEDDING_RESPONSE_INVALID');
    }
    if (body.model !== this.config.model || !Array.isArray(body.data)) {
      throw new EmbeddingGatewayError('EMBEDDING_RESPONSE_INVALID');
    }

    const vectors = [...body.data]
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map((item) => item.embedding as readonly number[]);
    assertEmbeddingVectors(
      vectors,
      providerTexts.length,
      request.expectedDimensions,
    );

    return Object.freeze({
      vectors: Object.freeze(vectors.map((vector) => Object.freeze([...vector]))),
      provider: 'http-approved',
      model: this.config.model,
      dimensions: this.config.dimensions,
      embeddingVersion: this.config.embeddingVersion,
      usage: Object.freeze({
        inputTokens: asUsage(body.usage?.prompt_tokens),
        totalTokens: asUsage(body.usage?.total_tokens),
        estimated: false,
      }),
    });
  }
}
