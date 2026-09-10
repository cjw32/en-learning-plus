import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  PronunciationStorageUnavailableError,
  type PronunciationAudioStorage,
  type PronunciationStoredAudio,
  type PutCanonicalPronunciationAudio,
  type PutPronunciationAudio,
} from './pronunciation-audio.storage';

const MAX_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

type PronunciationLifecycleConfig = Readonly<{
  Rule: readonly Readonly<{
    Status?: unknown;
    Prefix?: unknown;
    Filter?: Readonly<{ Prefix?: unknown }>;
    Expiration?: Readonly<{ Days?: unknown }>;
  }>[];
}>;

export interface PronunciationMinioClient {
  bucketExists(bucket: string): Promise<boolean>;
  getBucketPolicy(bucket: string): Promise<string>;
  getBucketLifecycle(
    bucket: string,
  ): Promise<PronunciationLifecycleConfig | null>;
  putObject(
    bucket: string,
    objectKey: string,
    bytes: Buffer,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<unknown>;
  getObject(bucket: string, objectKey: string): Promise<Readable>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
  makeBucket(...args: unknown[]): unknown;
  setBucketPolicy(...args: unknown[]): unknown;
  setBucketLifecycle(...args: unknown[]): unknown;
  presignedGetObject(...args: unknown[]): unknown;
}

export type MinioPronunciationAudioStorageConfig = Readonly<{
  approved: boolean;
  bucket: string;
  prefix: string;
  retentionHours: number;
}>;

function unavailable(): PronunciationStorageUnavailableError {
  return new PronunciationStorageUnavailableError();
}

function grantsAnonymousRead(policyText: string): boolean {
  let policy: unknown;
  try {
    policy = JSON.parse(policyText);
  } catch {
    throw unavailable();
  }
  const statements = (policy as { Statement?: unknown })?.Statement;
  if (!Array.isArray(statements)) throw unavailable();
  return statements.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const statement = candidate as Record<string, unknown>;
    const actions = Array.isArray(statement.Action)
      ? statement.Action.filter(
          (action: unknown): action is string => typeof action === 'string',
        )
      : typeof statement.Action === 'string'
        ? [statement.Action]
        : [];
    const principal = statement.Principal;
    const anonymous =
      principal === '*' ||
      (principal !== null &&
        typeof principal === 'object' &&
        Object.values(principal as Record<string, unknown>).some(
          (value) =>
            value === '*' || (Array.isArray(value) && value.includes('*')),
        ));
    return (
      statement.Effect === 'Allow' &&
      anonymous &&
      actions.some((action) => action === 's3:GetObject' || action === 's3:*')
    );
  });
}

async function readBounded(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value as Uint8Array);
    size += chunk.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      stream.destroy();
      throw unavailable();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class MinioPronunciationAudioStorage implements PronunciationAudioStorage {
  constructor(
    private readonly client: PronunciationMinioClient,
    private readonly config: MinioPronunciationAudioStorageConfig,
    private readonly id: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async assertPrivateLifecycleReady(): Promise<void> {
    if (
      !this.config.approved ||
      !this.config.bucket.trim() ||
      !this.config.prefix.startsWith('pronunciation/') ||
      this.config.retentionHours <= 0 ||
      this.config.retentionHours > 24 ||
      !(await this.client.bucketExists(this.config.bucket))
    ) {
      throw unavailable();
    }
    const policy = await this.client.getBucketPolicy(this.config.bucket);
    if (grantsAnonymousRead(policy)) throw unavailable();
    const lifecycle = await this.client.getBucketLifecycle(this.config.bucket);
    const hasExpiry = lifecycle?.Rule.some((rule) => {
      const configuredPrefix = rule.Filter?.Prefix ?? rule.Prefix;
      const prefix =
        typeof configuredPrefix === 'string' ? configuredPrefix : '';
      return (
        rule.Status === 'Enabled' &&
        this.config.prefix.startsWith(prefix) &&
        typeof rule.Expiration?.Days === 'number' &&
        rule.Expiration.Days > 0 &&
        rule.Expiration.Days <= 1
      );
    });
    if (!hasExpiry) throw unavailable();
  }

  async putQuarantined(
    input: PutPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    return this.put('quarantine', input.bytes, input.expiresAt);
  }

  async putCanonical(
    input: PutCanonicalPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    return this.put('canonical', input.bytes, input.expiresAt);
  }

  private async put(
    area: 'quarantine' | 'canonical',
    inputBytes: Uint8Array,
    expiresAt: Date,
  ): Promise<PronunciationStoredAudio> {
    const now = this.now();
    const retentionMs = expiresAt.getTime() - now.getTime();
    if (
      inputBytes.byteLength === 0 ||
      inputBytes.byteLength > MAX_AUDIO_BYTES ||
      retentionMs <= 0 ||
      retentionMs > MAX_RETENTION_MS
    ) {
      throw unavailable();
    }
    const objectKey = `${this.config.prefix}${area}/${this.id()}`;
    const bytes = Buffer.from(inputBytes);
    await this.client.putObject(
      this.config.bucket,
      objectKey,
      bytes,
      bytes.byteLength,
      {
        'content-type':
          area === 'canonical' ? 'audio/wav' : 'application/octet-stream',
        'cache-control': 'private, no-store',
      },
    );
    return Object.freeze({
      objectKey,
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expiresAt: new Date(expiresAt),
    });
  }

  async read(objectKey: string): Promise<Uint8Array> {
    this.assertOwnedKey(objectKey);
    return readBounded(
      await this.client.getObject(this.config.bucket, objectKey),
    );
  }

  async revoke(objectKey: string): Promise<void> {
    await this.remove(objectKey);
  }

  async purge(objectKey: string): Promise<void> {
    await this.remove(objectKey);
  }

  private async remove(objectKey: string): Promise<void> {
    this.assertOwnedKey(objectKey);
    await this.client.removeObject(this.config.bucket, objectKey);
  }

  private assertOwnedKey(objectKey: string): void {
    if (
      (!objectKey.startsWith(`${this.config.prefix}quarantine/`) &&
        !objectKey.startsWith(`${this.config.prefix}canonical/`)) ||
      objectKey.includes('..')
    ) {
      throw unavailable();
    }
  }
}
