import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toWebRequest } from '@modelcontextprotocol/node';
import type { INestApplication } from '@nestjs/common';
import { MCP_RUNTIME_CONFIG } from '../config/mcp.config';

export const MCP_HTTP_REQUEST_HANDLER = Symbol('MCP_HTTP_REQUEST_HANDLER');

export interface McpHttpRequestHandler {
  handle(request: Request, signal: AbortSignal): Promise<Response>;
}

type EventSource = Readonly<{
  once(event: string, listener: () => void): unknown;
}>;

export function bindMcpAbortSignal(
  request: EventSource,
  response: EventSource,
): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  return controller.signal;
}

type BoundaryIncomingMessage = IncomingMessage & {
  body?: unknown;
  originalUrl?: string;
};

function fullRequestUrl(
  request: BoundaryIncomingMessage,
  converted: Request,
): string {
  if (!request.originalUrl) return converted.url;
  const protocol = (request.socket as { encrypted?: boolean }).encrypted
    ? 'https'
    : 'http';
  const host = request.headers.host ?? 'localhost';
  return new URL(request.originalUrl, `${protocol}://${host}`).href;
}

function copyHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!['connection', 'transfer-encoding'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });
  return headers;
}

export function createMcpRawHttpHandler(
  handler: McpHttpRequestHandler,
): (
  request: BoundaryIncomingMessage,
  response: ServerResponse,
) => Promise<void> {
  return async (request, response) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const cleanup = () => {
      request.off('aborted', abort);
      response.off('close', abort);
    };
    request.once('aborted', abort);
    response.once('close', abort);

    try {
      const converted = await toWebRequest(request, request.body, {
        signal: controller.signal,
      });
      const incoming = request.originalUrl
        ? new Request(fullRequestUrl(request, converted), converted)
        : converted;
      const outgoing = await handler.handle(incoming, controller.signal);
      if (controller.signal.aborted || response.destroyed) return;

      response.writeHead(outgoing.status, copyHeaders(outgoing));
      if (!outgoing.body) {
        cleanup();
        response.end();
        return;
      }

      const reader = outgoing.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!response.write(chunk.value)) await once(response, 'drain');
        }
      } finally {
        reader.releaseLock();
      }
      cleanup();
      response.end();
    } catch {
      if (controller.signal.aborted || response.destroyed) return;
      cleanup();
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal error' },
        }),
      );
    } finally {
      if (response.writableEnded || response.destroyed) cleanup();
    }
  };
}

export function mountMcpHttpBoundary(app: INestApplication): boolean {
  const config = app.get(MCP_RUNTIME_CONFIG);
  if (!config.enabled) return false;

  const handler = app.get<McpHttpRequestHandler>(MCP_HTTP_REQUEST_HANDLER);
  const rawHandler = createMcpRawHttpHandler(handler);
  app.use(
    (
      request: BoundaryIncomingMessage,
      response: ServerResponse,
      next: () => void,
    ) => {
      const pathname = new URL(
        request.originalUrl ?? request.url ?? '/',
        'http://mcp.local',
      ).pathname;
      if (pathname !== '/ai/v1/mcp') return next();
      return rawHandler(request, response);
    },
  );
  return true;
}
