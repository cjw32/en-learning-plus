import { FakeEmbeddingGateway } from '../../src/knowledge/embedding/fake-embedding.gateway';
import { HttpEmbeddingGateway } from '../../src/knowledge/embedding/http-embedding.gateway';

describe('RAG embedding gateway contract', () => {
  it('returns deterministic finite non-zero vectors from the fake', async () => {
    const gateway = new FakeEmbeddingGateway({
      dimensions: 8,
      embeddingVersion: 'embedding.fake.8d.v1',
    });
    const request = {
      texts: ['harbor meaning', 'present perfect rule'],
      expectedDimensions: 8,
      embeddingVersion: 'embedding.fake.8d.v1',
    };

    const first = await gateway.embed(request);
    const second = await gateway.embed(request);

    expect(first).toEqual(second);
    expect(first.vectors).toHaveLength(2);
    expect(
      first.vectors.every((vector) => vector.some((value) => value !== 0)),
    ).toBe(true);
    expect(first.vectors.flat().every(Number.isFinite)).toBe(true);
  });

  it('sends only texts and approved model to the HTTP provider', async () => {
    let capturedBody: unknown;
    const fetchImplementation: typeof fetch = jest.fn(async (_input, init) => {
      capturedBody = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      );
      return new Response(
        JSON.stringify({
          model: 'approved-model',
          data: [{ index: 0, embedding: [1, 0, 0, 0] }],
          usage: { prompt_tokens: 3, total_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const gateway = new HttpEmbeddingGateway(
      {
        approved: true,
        endpoint: 'https://embedding.invalid/v1/embeddings',
        apiKey: 'test-key-not-real',
        model: 'approved-model',
        dimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        allowPrivateContent: false,
        timeoutMs: 100,
        maxRetries: 0,
      },
      fetchImplementation,
    );

    await gateway.embed({
      texts: ['minimal normalized text'],
      expectedDimensions: 4,
      embeddingVersion: 'embedding.approved.4d.v1',
    });

    expect(capturedBody).toEqual({
      model: 'approved-model',
      input: ['minimal normalized text'],
    });
    expect(JSON.stringify(capturedBody)).not.toMatch(
      /userId|jwt|course|email|phone|sourceRights|test-key-not-real/i,
    );
  });

  it.each([
    ['wrong count', { data: [], model: 'approved-model' }],
    [
      'wrong dimensions',
      { data: [{ index: 0, embedding: [1, 0] }], model: 'approved-model' },
    ],
    [
      'non-finite vector',
      {
        data: [{ index: 0, embedding: [1, 0, null, 0] }],
        model: 'approved-model',
      },
    ],
    [
      'zero vector',
      {
        data: [{ index: 0, embedding: [0, 0, 0, 0] }],
        model: 'approved-model',
      },
    ],
  ])('rejects %s responses', async (_name, responseBody) => {
    const gateway = new HttpEmbeddingGateway(
      {
        approved: true,
        endpoint: 'https://embedding.invalid/v1/embeddings',
        apiKey: 'test-key-not-real',
        model: 'approved-model',
        dimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        allowPrivateContent: false,
        timeoutMs: 100,
        maxRetries: 0,
      },
      jest.fn(
        async () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ) as typeof fetch,
    );

    await expect(
      gateway.embed({
        texts: ['minimal normalized text'],
        expectedDimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
      }),
    ).rejects.toThrow();
  });

  it('rejects unapproved providers before network access', async () => {
    const fetchImplementation = jest.fn();
    const gateway = new HttpEmbeddingGateway(
      {
        approved: false,
        endpoint: null,
        apiKey: null,
        model: null,
        dimensions: null,
        embeddingVersion: null,
        allowPrivateContent: false,
        timeoutMs: 100,
        maxRetries: 0,
      },
      fetchImplementation as typeof fetch,
    );

    await expect(
      gateway.embed({
        texts: ['minimal normalized text'],
        expectedDimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
      }),
    ).rejects.toThrow('EMBEDDING_PROVIDER_UNAPPROVED');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('sends an approved private projection without eligibility or identity metadata', async () => {
    let capturedBody: unknown;
    const fetchImplementation: typeof fetch = jest.fn(async (_input, init) => {
      capturedBody = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      );
      return new Response(
        JSON.stringify({
          model: 'approved-model',
          data: [{ index: 0, embedding: [1, 0, 0, 0] }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const gateway = new HttpEmbeddingGateway(
      {
        approved: true,
        endpoint: 'https://embedding.invalid/v1/embeddings',
        apiKey: 'test-key-not-real',
        model: 'approved-model',
        dimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        allowPrivateContent: true,
        timeoutMs: 100,
        maxRetries: 0,
      },
      fetchImplementation,
    );

    await gateway.embed({
      texts: ['  Target harbor\nCorrection port  '],
      expectedDimensions: 4,
      embeddingVersion: 'embedding.approved.4d.v1',
      containsPrivateContent: true,
      privateContentEligibility: {
        approved: true,
        purpose: 'PRIVATE_LEARNING_EMBEDDING',
        minimizationVersion: 'private-embedding-minimal.v1',
      },
    });

    expect(capturedBody).toEqual({
      model: 'approved-model',
      input: ['Target harbor Correction port'],
    });
    expect(JSON.stringify(capturedBody)).not.toMatch(
      /userId|subjectId|jwt|email|phone|answerKey|gradingRubric|eligibility|purpose|test-key-not-real/i,
    );
  });

  it.each([
    ['missing eligibility', ['Target harbor Correction port'], undefined],
    [
      'identity or technical payload',
      ['userId=user-a answerKey=secret other@example.com'],
      {
        approved: true as const,
        purpose: 'PRIVATE_LEARNING_EMBEDDING' as const,
        minimizationVersion: 'private-embedding-minimal.v1' as const,
      },
    ],
  ])(
    'fails closed for private content with %s',
    async (_name, texts, eligibility) => {
      const fetchImplementation = jest.fn();
      const gateway = new HttpEmbeddingGateway(
        {
          approved: true,
          endpoint: 'https://embedding.invalid/v1/embeddings',
          apiKey: 'test-key-not-real',
          model: 'approved-model',
          dimensions: 4,
          embeddingVersion: 'embedding.approved.4d.v1',
          allowPrivateContent: true,
          timeoutMs: 100,
          maxRetries: 0,
        },
        fetchImplementation as typeof fetch,
      );

      await expect(
        gateway.embed({
          texts,
          expectedDimensions: 4,
          embeddingVersion: 'embedding.approved.4d.v1',
          containsPrivateContent: true,
          ...(eligibility ? { privateContentEligibility: eligibility } : {}),
        }),
      ).rejects.toThrow('EMBEDDING_PRIVATE_CONTENT_UNAPPROVED');
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it('retries one approved rate limit and then succeeds within the finite limit', async () => {
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'approved-model',
            data: [{ index: 0, embedding: [1, 0, 0, 0] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const gateway = new HttpEmbeddingGateway(
      {
        approved: true,
        endpoint: 'https://embedding.invalid/v1/embeddings',
        apiKey: 'test-key-not-real',
        model: 'approved-model',
        dimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        allowPrivateContent: false,
        timeoutMs: 100,
        maxRetries: 1,
      },
      fetchImplementation as typeof fetch,
    );
    await expect(
      gateway.embed({
        texts: ['minimal normalized text'],
        expectedDimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
      }),
    ).resolves.toMatchObject({ model: 'approved-model' });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('does not start or retry after cancellation or the caller deadline', async () => {
    const fetchImplementation = jest.fn();
    const gateway = new HttpEmbeddingGateway(
      {
        approved: true,
        endpoint: 'https://embedding.invalid/v1/embeddings',
        apiKey: 'test-key-not-real',
        model: 'approved-model',
        dimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        allowPrivateContent: false,
        timeoutMs: 100,
        maxRetries: 3,
      },
      fetchImplementation as typeof fetch,
      () => 1_000,
    );
    const abort = new AbortController();
    abort.abort();
    await expect(
      gateway.embed({
        texts: ['minimal normalized text'],
        expectedDimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        signal: abort.signal,
      }),
    ).rejects.toThrow('EMBEDDING_TIMEOUT');
    await expect(
      gateway.embed({
        texts: ['minimal normalized text'],
        expectedDimensions: 4,
        embeddingVersion: 'embedding.approved.4d.v1',
        deadlineAt: new Date(999),
      }),
    ).rejects.toThrow('EMBEDDING_TIMEOUT');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
