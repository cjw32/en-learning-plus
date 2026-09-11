import {
  createMcpHandler,
  type McpHttpHandler,
  type McpServer,
} from '@modelcontextprotocol/server';

export type McpModernTransportFactoryOptions = Readonly<{
  createServer: () => McpServer | Promise<McpServer>;
  onerror?: (error: Error) => void;
}>;

export class McpModernTransportFactory {
  private readonly handler: McpHttpHandler;

  constructor(options: McpModernTransportFactoryOptions) {
    this.handler = createMcpHandler(() => options.createServer(), {
      legacy: 'reject',
      keepAliveMs: 0,
      onerror: options.onerror,
    });
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed.', {
        status: 405,
        headers: { allow: 'POST' },
      });
    }

    return this.handler.fetch(request);
  }

  async close(): Promise<void> {
    await this.handler.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
