/* eslint-disable @typescript-eslint/require-await -- Fail-closed and in-memory storage adapters intentionally preserve the production async port. */

import { createHash } from 'node:crypto';

export const PRONUNCIATION_AUDIO_STORAGE = Symbol(
  'PRONUNCIATION_AUDIO_STORAGE',
);

export type PronunciationStoredAudio = Readonly<{
  objectKey: string;
  byteSize: number;
  sha256: string;
  expiresAt: Date;
}>;

export type PutPronunciationAudio = Readonly<{
  assessmentId: string;
  bytes: Uint8Array;
  declaredMediaType: string;
  expiresAt: Date;
}>;

export type PutCanonicalPronunciationAudio = Readonly<{
  assessmentId: string;
  bytes: Uint8Array;
  expiresAt: Date;
}>;

export interface PronunciationAudioStorage {
  assertPrivateLifecycleReady(): Promise<void>;
  putQuarantined(
    input: PutPronunciationAudio,
  ): Promise<PronunciationStoredAudio>;
  putCanonical(
    input: PutCanonicalPronunciationAudio,
  ): Promise<PronunciationStoredAudio>;
  read(objectKey: string): Promise<Uint8Array>;
  revoke(objectKey: string): Promise<void>;
  purge(objectKey: string): Promise<void>;
}

export class PronunciationStorageUnavailableError extends Error {
  readonly code = 'STORAGE_NOT_APPROVED';

  constructor() {
    super('Pronunciation audio storage is unavailable');
    this.name = 'PronunciationStorageUnavailableError';
  }
}

export class UnavailablePronunciationAudioStorage implements PronunciationAudioStorage {
  private unavailable(): never {
    throw new PronunciationStorageUnavailableError();
  }

  async assertPrivateLifecycleReady(): Promise<void> {
    this.unavailable();
  }

  async putQuarantined(
    _input: PutPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    return this.unavailable();
  }

  async putCanonical(
    _input: PutCanonicalPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    return this.unavailable();
  }

  async read(_objectKey: string): Promise<Uint8Array> {
    return this.unavailable();
  }

  async revoke(_objectKey: string): Promise<void> {
    this.unavailable();
  }

  async purge(_objectKey: string): Promise<void> {
    this.unavailable();
  }
}

/** Test-only in-memory adapter. Production code must use the private adapter. */
export class FakePronunciationAudioStorage implements PronunciationAudioStorage {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; revoked: boolean }
  >();
  private sequence = 0;

  async assertPrivateLifecycleReady(): Promise<void> {}

  async putQuarantined(
    input: PutPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    this.sequence += 1;
    const objectKey = `test-pronunciation-object-${this.sequence}`;
    const bytes = Uint8Array.from(input.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.objects.set(objectKey, { bytes, revoked: false });
    return Object.freeze({
      objectKey,
      byteSize: bytes.byteLength,
      sha256,
      expiresAt: new Date(input.expiresAt),
    });
  }

  async putCanonical(
    input: PutCanonicalPronunciationAudio,
  ): Promise<PronunciationStoredAudio> {
    this.sequence += 1;
    const objectKey = `test-pronunciation-canonical-${this.sequence}`;
    const bytes = Uint8Array.from(input.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.objects.set(objectKey, { bytes, revoked: false });
    return Object.freeze({
      objectKey,
      byteSize: bytes.byteLength,
      sha256,
      expiresAt: new Date(input.expiresAt),
    });
  }

  async read(objectKey: string): Promise<Uint8Array> {
    const stored = this.objects.get(objectKey);
    if (!stored || stored.revoked) throw new Error('Audio object not found');
    return Uint8Array.from(stored.bytes);
  }

  async revoke(objectKey: string): Promise<void> {
    const stored = this.objects.get(objectKey);
    if (stored) stored.revoked = true;
  }

  async purge(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
}
