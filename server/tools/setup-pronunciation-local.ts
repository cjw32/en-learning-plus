import { config as loadEnv } from 'dotenv';
import { Client, type LifecycleConfig } from 'minio';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  MinioPronunciationAudioStorage,
  type PronunciationMinioClient,
} from '../apps/ai/src/pronunciation/storage/minio-pronunciation-audio.storage';
import { FfmpegPronunciationAudioInspector } from '../apps/ai/src/pronunciation/audio/ffmpeg-pronunciation-audio-inspector';

// Local setup only. Never prints secrets or sends audio to Azure.
loadEnv({ path: '.env', quiet: true });
const env = process.env;
function required(key: string): string {
  assert(env[key]?.trim(), `Missing ${key}`);
  return env[key]!.trim();
}

async function main() {
  assert.equal(required('MINIO_ENDPOINT'), '127.0.0.1');
  assert.equal(required('MINIO_PORT'), '19000');
  assert.equal(required('MINIO_USE_SSL'), '0');
  assert.equal(required('REDIS_HOST'), '127.0.0.1');
  assert.equal(required('REDIS_PORT'), '16379');
  const bucket = required('PRONUNCIATION_AUDIO_BUCKET');
  assert.equal(bucket, 'pronunciation-private');
  assert.notEqual(bucket, env.MINIO_BUCKET);
  const minio = new Client({
    endPoint: '127.0.0.1',
    port: 19000,
    useSSL: false,
    accessKey: required('MINIO_ACCESS_KEY'),
    secretKey: required('MINIO_SECRET_KEY'),
  });
  if (!(await minio.bucketExists(bucket))) {
    await minio.makeBucket(bucket);
  }
  let policy = '';
  try {
    policy = await minio.getBucketPolicy(bucket);
  } catch (error) {
    if ((error as { code?: string }).code !== 'NoSuchBucketPolicy') throw error;
  }
  // An unexpected existing policy must be reviewed, never silently replaced.
  assert(
    !policy || JSON.parse(policy).Statement?.length === 0,
    'Unexpected existing bucket policy',
  );
  let lifecycle: LifecycleConfig | null = null;
  try {
    lifecycle = await minio.getBucketLifecycle(bucket);
  } catch (error) {
    if ((error as { code?: string }).code !== 'NoSuchLifecycleConfiguration') {
      throw error;
    }
  }
  if (!lifecycle) {
    await minio.setBucketLifecycle(bucket, {
      Rule: [
        {
          ID: 'pronunciation-expire-one-day',
          Status: 'Enabled',
          Filter: { Prefix: 'pronunciation/' },
          Expiration: { Days: 1 },
        },
      ],
    });
  }
  const storage = new MinioPronunciationAudioStorage(
    minio as unknown as PronunciationMinioClient,
    {
      approved: true,
      bucket,
      prefix: 'pronunciation/',
      retentionHours: 24,
    },
  );
  await storage.assertPrivateLifecycleReady();
  const inspector = new FfmpegPronunciationAudioInspector({
    approved: true,
    ffmpegPath: required('PRONUNCIATION_FFMPEG_PATH'),
    ffprobePath: required('PRONUNCIATION_FFPROBE_PATH'),
    timeoutMs: 10000,
    maxOutputBytes: 3 * 1024 * 1024,
    maxMemoryBytes: 128 * 1024 * 1024,
    maxConcurrent: 1,
  });
  await inspector.assertRuntimeReady();
  // A generated tone checks real decoding, not pronunciation scoring quality.
  const webm = execFileSync(
    required('PRONUNCIATION_FFMPEG_PATH'),
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libopus',
      '-f',
      'webm',
      'pipe:1',
    ],
    {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const audio = await inspector.inspectAndCanonicalize({
    bytes: webm,
    declaredMediaType: 'audio/webm',
    deadlineAt: new Date(Date.now() + 10000),
  });
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channelCount, 1);
  assert.equal(
    Buffer.from(audio.canonicalAudio).subarray(0, 4).toString(),
    'RIFF',
  );
  const stored = await storage.putCanonical({
    assessmentId: 'local-setup-check',
    bytes: audio.canonicalAudio,
    expiresAt: new Date(Date.now() + 60000),
  });
  try {
    assert.deepEqual(
      await storage.read(stored.objectKey),
      audio.canonicalAudio,
    );
    const anonymous = await fetch(
      `http://127.0.0.1:19000/${bucket}/${stored.objectKey}`,
      {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      },
    );
    await anonymous.arrayBuffer();
    assert.equal(anonymous.status, 403);
  } finally {
    await storage.purge(stored.objectKey);
  }
  let deleted = false;
  try {
    await minio.statObject(bucket, stored.objectKey);
  } catch (error) {
    if ((error as { code?: string }).code === 'NotFound') deleted = true;
    else throw error;
  }
  assert(deleted, 'Synthetic object must be removed');

  const redis = new Redis({
    host: '127.0.0.1',
    port: 16379,
    password: required('REDIS_PASSWORD'),
    db: Number(required('PRONUNCIATION_REDIS_DB')),
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    assert.equal(await redis.ping(), 'PONG');
    for (const [key, value] of [
      ['appendonly', 'yes'],
      ['appendfsync', 'always'],
      ['maxmemory-policy', 'noeviction'],
    ]) {
      assert.deepEqual(await redis.config('GET', key), [key, value]);
    }
    const key = `pronunciation:setup-check:${randomUUID()}`;
    try {
      await redis.set(key, 'ok', 'EX', 60);
      assert.equal(await redis.get(key), 'ok');
    } finally {
      await redis.del(key);
    }
  } finally {
    redis.disconnect();
  }
  console.log(
    JSON.stringify(
      {
        privateBucket: true,
        oneDayLifecycle: true,
        anonymousReadDenied: true,
        syntheticAudioDeleted: true,
        realWebmConversion: true,
        audioDurationMs: audio.durationMs,
        redisConnected: true,
        redisPersistence: 'AOF always',
        redisEviction: 'noeviction',
        azureCalled: false,
        featureFlagsChanged: false,
      },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  // Do not print error messages containing environment or request credentials.
  console.error('Local pronunciation setup failed', {
    type: error instanceof Error ? error.name : 'Error',
    code: (error as { code?: string })?.code ?? 'CHECK_FAILED',
  });
  process.exitCode = 1;
});
