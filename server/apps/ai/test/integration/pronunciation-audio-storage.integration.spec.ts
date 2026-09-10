import { Readable } from 'node:stream';
import {
  MinioPronunciationAudioStorage,
  type PronunciationMinioClient,
} from '../../src/pronunciation/storage/minio-pronunciation-audio.storage';

function client(
  overrides: Partial<PronunciationMinioClient> = {},
): jest.Mocked<PronunciationMinioClient> {
  return {
    bucketExists: jest.fn().mockResolvedValue(true),
    getBucketPolicy: jest.fn().mockResolvedValue(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [],
      }),
    ),
    getBucketLifecycle: jest.fn().mockResolvedValue({
      Rule: [
        {
          ID: 'pronunciation-expiry',
          Status: 'Enabled',
          Filter: { Prefix: 'pronunciation/' },
          Expiration: { Days: 1 },
        },
      ],
    }),
    putObject: jest.fn().mockResolvedValue({ etag: 'fixture-etag' }),
    getObject: jest.fn().mockResolvedValue(Readable.from([Buffer.from('abc')])),
    removeObject: jest.fn().mockResolvedValue(undefined),
    makeBucket: jest.fn(),
    setBucketPolicy: jest.fn(),
    setBucketLifecycle: jest.fn(),
    presignedGetObject: jest.fn(),
    ...overrides,
  };
}

function storage(minio: PronunciationMinioClient) {
  return new MinioPronunciationAudioStorage(
    minio,
    {
      approved: true,
      bucket: 'pronunciation-private',
      prefix: 'pronunciation/',
      retentionHours: 24,
    },
    () => '00000000-0000-4000-8000-000000000001',
    () => new Date('2026-09-10T00:00:00.000Z'),
  );
}

describe('private pronunciation audio storage contract', () => {
  it('validates an existing private, lifecycle-bounded bucket without mutating it', async () => {
    const minio = client();
    await expect(
      storage(minio).assertPrivateLifecycleReady(),
    ).resolves.toBeUndefined();
    expect(minio.makeBucket).not.toHaveBeenCalled();
    expect(minio.setBucketPolicy).not.toHaveBeenCalled();
    expect(minio.setBucketLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    [
      'anonymous read',
      {
        getBucketPolicy: jest.fn().mockResolvedValue(
          JSON.stringify({
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: ['arn:aws:s3:::pronunciation-private/*'],
              },
            ],
          }),
        ),
      },
    ],
    [
      'missing lifecycle',
      { getBucketLifecycle: jest.fn().mockResolvedValue(null) },
    ],
    [
      'retention beyond 24 hours',
      {
        getBucketLifecycle: jest.fn().mockResolvedValue({
          Rule: [
            {
              Status: 'Enabled',
              Filter: { Prefix: 'pronunciation/' },
              Expiration: { Days: 2 },
            },
          ],
        }),
      },
    ],
  ])('rejects %s and never mutates policy', async (_name, override) => {
    const minio = client(override as Partial<PronunciationMinioClient>);
    await expect(
      storage(minio).assertPrivateLifecycleReady(),
    ).rejects.toMatchObject({
      code: 'STORAGE_NOT_APPROVED',
    });
    expect(minio.setBucketPolicy).not.toHaveBeenCalled();
    expect(minio.setBucketLifecycle).not.toHaveBeenCalled();
  });

  it('uses a random content-free quarantine key and authenticated server-side reads', async () => {
    const minio = client();
    const adapter = storage(minio);
    const stored = await adapter.putQuarantined({
      assessmentId: 'assessment-sensitive-id',
      bytes: Uint8Array.from([1, 2, 3]),
      declaredMediaType: 'audio/webm',
      expiresAt: new Date('2026-09-11T00:00:00.000Z'),
    });
    expect(stored.objectKey).toBe(
      'pronunciation/quarantine/00000000-0000-4000-8000-000000000001',
    );
    expect(stored.objectKey).not.toContain('assessment-sensitive-id');
    expect(await adapter.read(stored.objectKey)).toEqual(
      Uint8Array.from([97, 98, 99]),
    );
    expect(minio.presignedGetObject).not.toHaveBeenCalled();
  });

  it('revokes immediately, purges idempotently and rejects retention beyond 24 hours', async () => {
    const minio = client();
    const adapter = storage(minio);
    await adapter.revoke('pronunciation/quarantine/object');
    await adapter.purge('pronunciation/quarantine/object');
    expect(minio.removeObject).toHaveBeenCalledTimes(2);
    await expect(
      adapter.putQuarantined({
        assessmentId: 'assessment_1',
        bytes: Uint8Array.from([1]),
        declaredMediaType: 'audio/webm',
        expiresAt: new Date('2026-09-11T00:00:00.001Z'),
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_APPROVED' });
  });
});
