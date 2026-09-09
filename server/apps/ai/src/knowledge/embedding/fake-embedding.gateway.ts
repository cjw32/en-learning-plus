import { createHash } from 'node:crypto';
import {
  EmbeddingGateway,
  EmbeddingRequest,
  EmbeddingResponse,
  assertEmbeddingRequest,
} from '@libs/learning/knowledge/ingestion/embedding.gateway';

export class FakeEmbeddingGateway implements EmbeddingGateway {
  constructor(
    private readonly config: Readonly<{
      dimensions: number;
      embeddingVersion: string;
    }>,
  ) {
    if (
      !Number.isInteger(config.dimensions) ||
      config.dimensions <= 0 ||
      !config.embeddingVersion.trim()
    ) {
      throw new Error('FAKE_EMBEDDING_CONFIG_INVALID');
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    assertEmbeddingRequest(request);
    if (
      request.expectedDimensions !== this.config.dimensions ||
      request.embeddingVersion !== this.config.embeddingVersion
    ) {
      throw new Error('EMBEDDING_REQUEST_INVALID');
    }

    const vectors = request.texts.map((text) => this.vectorFor(text));
    const estimatedTokens = request.texts.reduce(
      (total, text) => total + Math.max(1, Math.ceil(text.length / 4)),
      0,
    );
    return Object.freeze({
      vectors: Object.freeze(vectors),
      provider: 'fake',
      model: 'deterministic-sha256',
      dimensions: this.config.dimensions,
      embeddingVersion: this.config.embeddingVersion,
      usage: Object.freeze({
        inputTokens: estimatedTokens,
        totalTokens: estimatedTokens,
        estimated: true,
      }),
    });
  }

  private vectorFor(text: string): readonly number[] {
    const seed = `${this.config.embeddingVersion}\0${text.normalize('NFKC').trim()}`;
    const values: number[] = [];
    let counter = 0;
    while (values.length < this.config.dimensions) {
      const digest = createHash('sha256')
        .update(seed)
        .update(String(counter))
        .digest();
      for (const byte of digest) {
        if (values.length >= this.config.dimensions) break;
        values.push((byte - 127.5) / 127.5);
      }
      counter += 1;
    }
    if (values.every((value) => value === 0)) {
      values[0] = 1;
    }
    return Object.freeze(values);
  }
}
