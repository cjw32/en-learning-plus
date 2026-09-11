import { Controller, Get, Module, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { InterceptorInterceptor } from '@libs/shared/interceptor/interceptor';

type RawBoundaryModule = {
  bindMcpAbortSignal(
    request: EventEmitter,
    response: EventEmitter,
  ): AbortSignal;
  createMcpRawHttpHandler(input: {
    handle(request: Request, signal: AbortSignal): Promise<Response>;
  }): (request: unknown, response: unknown) => Promise<void>;
};

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/transport/mcp-http-boundary.ts',
);

function loadBoundary(): RawBoundaryModule {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing raw MCP HTTP boundary (T041)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath) as RawBoundaryModule;
}

@Controller('ordinary')
class OrdinaryController {
  @Get()
  read() {
    return { data: { value: 'still-wrapped' } };
  }
}

@Module({ controllers: [OrdinaryController] })
class BoundaryTestModule {}

describe('MCP raw HTTP boundary', () => {
  it('bypasses the global envelope while preserving JSON-RPC status and headers', async () => {
    const boundary = loadBoundary();
    const seen: Array<{ url: string; signal: AbortSignal }> = [];
    const rawHandler = boundary.createMcpRawHttpHandler({
      handle: async (incoming, signal) => {
        seen.push({ url: incoming.url, signal });
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { resultType: 'complete', value: 'raw' },
          }),
          {
            status: 207,
            headers: {
              'content-type': 'application/json',
              'cache-control': 'private, no-store',
              'x-mcp-contract': 'raw',
            },
          },
        );
      },
    });
    const testingModule = await Test.createTestingModule({
      imports: [BoundaryTestModule],
    }).compile();
    const app = testingModule.createNestApplication();
    app.use('/ai/v1/mcp', rawHandler);
    app.useGlobalInterceptors(new InterceptorInterceptor());
    app.setGlobalPrefix('ai');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    try {
      const mcp = await request(app.getHttpServer())
        .post('/ai/v1/mcp')
        .set('content-type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'server/discover' })
        .expect(207);
      expect(mcp.headers['cache-control']).toBe('private, no-store');
      expect(mcp.headers['x-mcp-contract']).toBe('raw');
      expect(mcp.body).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { resultType: 'complete', value: 'raw' },
      });
      expect(mcp.body).not.toHaveProperty('timestamp');
      expect(mcp.body).not.toHaveProperty('success');
      expect(seen).toHaveLength(1);
      expect(seen[0]?.signal.aborted).toBe(false);

      const ordinary = await request(app.getHttpServer())
        .get('/ai/v1/ordinary')
        .expect(200);
      expect(ordinary.body).toMatchObject({
        success: true,
        data: { value: 'still-wrapped' },
      });
    } finally {
      await app.close();
    }
  });

  it('writes SSE bytes without JSON parsing or envelope mutation', async () => {
    const boundary = loadBoundary();
    const rawHandler = boundary.createMcpRawHttpHandler({
      handle: async () =>
        new Response('event: message\ndata: {"jsonrpc":"2.0"}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    const testingModule = await Test.createTestingModule({
      imports: [BoundaryTestModule],
    }).compile();
    const app = testingModule.createNestApplication();
    app.use('/ai/v1/mcp', rawHandler);
    app.useGlobalInterceptors(new InterceptorInterceptor());
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .get('/ai/v1/mcp')
        .expect(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.text).toBe('event: message\ndata: {"jsonrpc":"2.0"}\n\n');
    } finally {
      await app.close();
    }
  });

  it('turns request abort and response close into the same cancellation signal', () => {
    const boundary = loadBoundary();
    for (const event of ['aborted', 'close'] as const) {
      const incoming = new EventEmitter();
      const outgoing = new EventEmitter();
      const signal = boundary.bindMcpAbortSignal(incoming, outgoing);
      const laterStage = jest.fn();

      (event === 'aborted' ? incoming : outgoing).emit(event);
      if (!signal.aborted) laterStage();

      expect(signal.aborted).toBe(true);
      expect(laterStage).not.toHaveBeenCalled();
    }
  });
});
