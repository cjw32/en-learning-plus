import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@libs/shared';
import { ChatController } from '../../src/chat/chat.controller';
import { ChatService } from '../../src/chat/chat.service';
import { createAgent } from 'langchain';
import { createCheckpoint } from '../../src/llm/llm.config';
jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('../../src/llm/llm.config', () => ({
  createCheckpoint: jest.fn(),
  createDeepSeek: jest.fn(),
}));

describe('Legacy chat authentication', () => {
  it('requires a verified access token on both routes', () => {
    expect(Reflect.getMetadata('__guards__', ChatController)).toContain(
      AuthGuard,
    );
    const jwt = new JwtService({ secret: 'test-only-secret' });
    const guard = new AuthGuard(jwt);
    const context = (headers) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;
    expect(() => guard.canActivate(context({}))).toThrow();
    expect(() =>
      guard.canActivate(context({ authorization: 'Bearer invalid' })),
    ).toThrow();
    const token = jwt.sign(
      { userId: 'owner', tokenType: 'refresh' },
      { expiresIn: '1h' },
    );
    expect(() =>
      guard.canActivate(context({ authorization: `Bearer ${token}` })),
    ).toThrow();
    const access = jwt.sign(
      { userId: 'owner', tokenType: 'access' },
      { expiresIn: '1h' },
    );
    expect(
      guard.canActivate(context({ authorization: `Bearer ${access}` })),
    ).toBe(true);
  });
  it('uses the authenticated identity for history and stream, ignoring body/query userId', async () => {
    const checkpoint = { get: jest.fn(async () => undefined) };
    (createCheckpoint as jest.Mock).mockResolvedValue(checkpoint);
    const stream = jest.fn(async function* () {});
    (createAgent as jest.Mock).mockReturnValue({ stream });
    const service = new ChatService({ success: (data) => data } as any);
    await service.onModuleInit();
    const controller = new ChatController(service);
    const request = {
      user: { userId: 'owner' },
      query: { userId: 'victim' },
    } as any;
    await controller.findAll(request, 'normal');
    expect(checkpoint.get).toHaveBeenCalledWith({
      configurable: { thread_id: 'owner-normal' },
    });
    const response = {
      once: jest.fn(),
      off: jest.fn(),
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
    } as any;
    await controller.create(
      {
        userId: 'victim',
        role: 'normal',
        content: 'Hello',
        deepThink: false,
        webSearch: false,
      } as any,
      request,
      response,
    );
    expect(stream.mock.calls[0][1].configurable.thread_id).toBe('owner-normal');
    await expect(
      controller.create({ role: 'unknown' } as any, request, response),
    ).rejects.toThrow();
    await expect(
      controller.create(
        {
          role: 'normal',
          content: 'x'.repeat(12001),
          deepThink: false,
          webSearch: false,
        },
        request,
        response,
      ),
    ).rejects.toThrow();
  });
});

describe('Chat stream failure handling', () => {
  const input = { role: 'normal', content: 'Hello', deepThink: false, webSearch: false } as const;
  const request = { user: { userId: 'owner' } } as any;
  it('leaves an initial model failure to the HTTP exception handler', async () => {
    const controller = new ChatController({ streamCompletion: async () => { throw new Error('model unavailable'); } } as any);
    const response = { once: jest.fn(), off: jest.fn(), setHeader: jest.fn(), end: jest.fn(), headersSent: false };
    await expect(controller.create(input, request, response as any)).rejects.toThrow('model unavailable');
    expect(response.end).not.toHaveBeenCalled();
    expect(response.off).toHaveBeenCalled();
  });
  it('emits an explicit error after response streaming has started', async () => {
    const controller = new ChatController({ streamCompletion: async () => (async function* () {
      yield [{ content: 'partial', additional_kwargs: {} }]; throw new Error('provider-secret');
    })() } as any);
    const response = { once: jest.fn(), off: jest.fn(), setHeader: jest.fn(), end: jest.fn(), headersSent: true, write: jest.fn() };
    await controller.create(input, request, response as any);
    expect(response.write.mock.calls.at(-1)[0]).toContain('event: error');
    expect(response.write.mock.calls.at(-1)[0]).not.toContain('provider-secret');
    expect(response.end).toHaveBeenCalled();
  });
});
