import { ConfigService } from '@nestjs/config';
import {
  PronunciationRedisConfigurationError,
  PronunciationRedisConnection,
  PronunciationRedisUnavailableError,
  resolvePronunciationRedisOptions,
  type PronunciationRedisClient,
  type PronunciationRedisClientFactory,
} from './pronunciation-redis.module';

function config(overrides: Record<string, string> = {}): ConfigService {
  return new ConfigService({
    REDIS_HOST: 'redis.internal',
    REDIS_PORT: '6380',
    REDIS_PASSWORD: 'redis-secret',
    PRONUNCIATION_REDIS_DB: '7',
    ...overrides,
  });
}

describe('pronunciation Redis connection', () => {
  it('uses exactly the same password and database for governance and BullMQ', () => {
    const connection = new PronunciationRedisConnection(config());
    expect(connection.getConnectionOptions()).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'redis-secret',
      db: 7,
    });
    expect(connection.getBullConnectionOptions()).toEqual(
      connection.getConnectionOptions(),
    );
  });

  it.each([
    ['PRONUNCIATION_REDIS_DB', ''],
    ['PRONUNCIATION_REDIS_DB', '-1'],
    ['PRONUNCIATION_REDIS_DB', '1.5'],
    ['REDIS_HOST', ''],
    ['REDIS_PORT', '0'],
  ])('fails closed for invalid %s=%s', (name, value) => {
    expect(() =>
      resolvePronunciationRedisOptions(config({ [name]: value })),
    ).toThrow(PronunciationRedisConfigurationError);
  });

  it('never falls back to database zero when the pronunciation DB is absent', () => {
    const missing = new ConfigService({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6379',
      REDIS_DB: '0',
      COACH_REDIS_DB: '1',
    });
    expect(() => resolvePronunciationRedisOptions(missing)).toThrow(
      'PRONUNCIATION_REDIS_DB is required',
    );
  });

  it('reports unavailable Redis without leaking connection details', async () => {
    const client: PronunciationRedisClient = {
      status: 'wait',
      connect: jest.fn().mockRejectedValue(new Error('redis-secret endpoint')),
      ping: jest.fn(),
      disconnect: jest.fn(),
    };
    const factory: PronunciationRedisClientFactory = jest
      .fn()
      .mockReturnValue(client);
    const connection = new PronunciationRedisConnection(config(), factory);

    await expect(connection.assertReady()).rejects.toEqual(
      new PronunciationRedisUnavailableError(),
    );
    expect(client.disconnect).toHaveBeenCalledWith(false);
    expect(
      JSON.stringify(new PronunciationRedisUnavailableError()),
    ).not.toContain('redis-secret');
  });

  it('does not construct or connect until explicitly requested', async () => {
    const client: PronunciationRedisClient = {
      status: 'ready',
      connect: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      disconnect: jest.fn(),
    };
    const factory: PronunciationRedisClientFactory = jest
      .fn()
      .mockReturnValue(client);
    const connection = new PronunciationRedisConnection(config(), factory);

    expect(factory).not.toHaveBeenCalled();
    await connection.assertReady();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.ping).toHaveBeenCalledTimes(1);
  });
});
