import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type ModernFactory = {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
};

type Sdk = {
  McpServer: new (info: { name: string; version: string }) => {
    registerResource(
      name: string,
      uri: string,
      config: { description: string; mimeType: string },
      callback: (uri: URL) => Promise<{
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      }>,
    ): unknown;
    registerTool(
      name: string,
      config: { description: string },
      callback: (context: { mcpReq: { signal: AbortSignal } }) => Promise<{
        content: Array<{ type: 'text'; text: string }>;
      }>,
    ): unknown;
    registerPrompt(
      name: string,
      config: { description: string },
      callback: () => Promise<{
        messages: Array<{
          role: 'user';
          content: { type: 'text'; text: string };
        }>;
      }>,
    ): unknown;
  };
  preloadSchemas(): Promise<void>;
  specTypeSchemas: Record<
    string,
    { safeParse(value: unknown): { success: boolean; error?: unknown } }
  >;
};

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/transport/mcp-modern-transport.factory.ts',
);

function loadFactory(): new (options: {
  createServer: () => InstanceType<Sdk['McpServer']>;
}) => ModernFactory {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing modern MCP transport factory (T037)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath).McpModernTransportFactory;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = require('@modelcontextprotocol/server') as Sdk;

const metaKeys = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
};

function body(method: string, id: number, version = '2026-07-28') {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      _meta: {
        [metaKeys.protocolVersion]: version,
        [metaKeys.clientInfo]: {
          name: 'mcp-modern-contract-client',
          version: '1.0.0',
        },
        [metaKeys.clientCapabilities]: {},
      },
    },
  };
}

function request(method: string, id: number, version = '2026-07-28') {
  return new Request('https://resource.mcp.test/ai/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': version,
      'mcp-method': method,
    },
    body: JSON.stringify(body(method, id, version)),
  });
}

function createFixture() {
  const createdServers: unknown[] = [];
  const ModernTransportFactory = loadFactory();
  const factory = new ModernTransportFactory({
    createServer: () => {
      const server = new sdk.McpServer({
        name: 'english-learning-mcp',
        version: '1.0.0',
      });
      server.registerResource(
        'word-example',
        'en-learning://words/example',
        { description: 'Example word', mimeType: 'application/json' },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: '{"word":"example"}',
            },
          ],
        }),
      );
      server.registerTool(
        'search_words',
        { description: 'Search words' },
        async () => ({ content: [{ type: 'text', text: '[]' }] }),
      );
      server.registerPrompt(
        'vocabulary_review',
        { description: 'Review vocabulary' },
        async () => ({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'Review vocabulary.' },
            },
          ],
        }),
      );
      createdServers.push(server);
      return server;
    },
  });
  return { factory, createdServers };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('MCP 2026-07-28 modern stateless transport contract', () => {
  beforeAll(async () => sdk.preloadSchemas());

  it('discovers exactly the modern protocol using an official SDK envelope', async () => {
    const { factory, createdServers } = createFixture();
    try {
      const response = await factory.handle(request('server/discover', 1));
      const payload = await json(response);

      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBeNull();
      expect(
        sdk.specTypeSchemas.JSONRPCMessage.safeParse(payload).success,
      ).toBe(true);
      expect(
        sdk.specTypeSchemas.DiscoverResult.safeParse(payload.result).success,
      ).toBe(true);
      expect(payload).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          supportedVersions: ['2026-07-28'],
          resultType: 'complete',
        },
      });
      expect(createdServers).toHaveLength(1);
    } finally {
      await factory.close();
    }
  });

  it.each([
    ['tools/list', 'ListToolsResult', 'tools', 'search_words'],
    ['resources/list', 'ListResourcesResult', 'resources', 'word-example'],
    ['prompts/list', 'ListPromptsResult', 'prompts', 'vocabulary_review'],
  ] as const)(
    'returns schema-valid %s discovery from a fresh request server',
    async (method, schemaName, collection, expectedName) => {
      const { factory, createdServers } = createFixture();
      try {
        const response = await factory.handle(request(method, 2));
        const payload = await json(response);
        expect(response.status).toBe(200);
        expect(
          sdk.specTypeSchemas.JSONRPCMessage.safeParse(payload).success,
        ).toBe(true);
        expect(
          sdk.specTypeSchemas[schemaName]?.safeParse(payload.result).success,
        ).toBe(true);
        expect(payload).toMatchObject({
          result: {
            [collection]: [expect.objectContaining({ name: expectedName })],
          },
        });
        expect(createdServers).toHaveLength(1);
      } finally {
        await factory.close();
      }
    },
  );

  it.each(['GET', 'DELETE'])(
    'rejects %s without allocating a session',
    async (method) => {
      const { factory, createdServers } = createFixture();
      try {
        const response = await factory.handle(
          new Request('https://resource.mcp.test/ai/v1/mcp', { method }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        expect(response.headers.get('mcp-session-id')).toBeNull();
        expect(createdServers).toHaveLength(0);
      } finally {
        await factory.close();
      }
    },
  );

  it.each(['2026-01-01', '2099-12-31'])(
    'fails unknown version %s safely',
    async (version) => {
      const { factory } = createFixture();
      try {
        const response = await factory.handle(
          request('server/discover', 3, version),
        );
        const payload = await json(response);
        expect(response.status).toBe(400);
        expect(
          sdk.specTypeSchemas.JSONRPCMessage.safeParse(payload).success,
        ).toBe(true);
        expect(payload).toMatchObject({
          jsonrpc: '2.0',
          id: 3,
          error: expect.objectContaining({ code: expect.any(Number) }),
        });
        expect(JSON.stringify(payload)).not.toMatch(
          /stack|node_modules|Error:/i,
        );
      } finally {
        await factory.close();
      }
    },
  );

  it('propagates the HTTP request AbortSignal into the official SDK handler context', async () => {
    let seenSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const factory = new (loadFactory())({
      createServer: () => {
        const server = new sdk.McpServer({
          name: 'english-learning-mcp',
          version: '1.0.0',
        });
        server.registerTool(
          'wait_for_abort',
          { description: 'Wait for client cancellation' },
          async (context) => {
            seenSignal = context.mcpReq.signal;
            markStarted();
            await new Promise<void>((resolve) => {
              if (seenSignal?.aborted) return resolve();
              seenSignal?.addEventListener('abort', () => resolve(), {
                once: true,
              });
            });
            return { content: [{ type: 'text', text: 'cancelled' }] };
          },
        );
        return server;
      },
    });
    const controller = new AbortController();
    const call = body('tools/call', 10);
    const pending = factory.handle(
      new Request('https://resource.mcp.test/ai/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'wait_for_abort',
        },
        body: JSON.stringify({
          ...call,
          params: {
            ...call.params,
            name: 'wait_for_abort',
            arguments: {},
          },
        }),
        signal: controller.signal,
      }),
    );

    try {
      await started;
      expect(seenSignal?.aborted).toBe(false);
      controller.abort();
      await pending.catch(() => undefined);
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      await factory.close();
    }
  });
});
