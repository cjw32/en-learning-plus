import type { PronunciationProviderAssessmentInput } from '@en/common/pronunciation';
import {
  FakePronunciationAudioInspector,
  UnavailablePronunciationAudioInspector,
} from '../../src/pronunciation/audio/pronunciation-audio-inspector';
import {
  FakePronunciationAssessmentProvider,
  UnavailablePronunciationAssessmentProvider,
} from '../../src/pronunciation/provider/pronunciation-assessment.provider';
import {
  FakePronunciationAudioStorage,
  UnavailablePronunciationAudioStorage,
} from '../../src/pronunciation/storage/pronunciation-audio.storage';

const providerInput: PronunciationProviderAssessmentInput = {
  assessmentId: 'assessment_1',
  referenceText: 'hello world',
  locale: 'en-US',
  canonicalAudio: Uint8Array.from([1, 2, 3]),
  applicationConnectionId: 'connection_1',
  deadlineAt: new Date('2030-01-01T00:00:00.000Z'),
};

describe('pronunciation ports', () => {
  it('provides deterministic fake storage with revoke and purge semantics', async () => {
    const storage = new FakePronunciationAudioStorage();
    const stored = await storage.putQuarantined({
      assessmentId: 'assessment_1',
      bytes: Uint8Array.from([1, 2, 3]),
      declaredMediaType: 'audio/webm',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(await storage.read(stored.objectKey)).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    await storage.revoke(stored.objectKey);
    await expect(storage.read(stored.objectKey)).rejects.toThrow(
      'Audio object not found',
    );
    await storage.purge(stored.objectKey);
  });

  it('provides fake inspection without sharing the mutable input buffer', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const inspected =
      await new FakePronunciationAudioInspector().inspectAndCanonicalize({
        bytes,
        declaredMediaType: 'audio/webm',
        deadlineAt: providerInput.deadlineAt,
      });
    bytes[0] = 9;
    expect(inspected.canonicalAudio).toEqual(Uint8Array.from([1, 2, 3]));
    expect(inspected.qualityStatus).toBe('READY');
  });

  it('provides a schema-valid fake Provider and records one isolated call', async () => {
    const provider = new FakePronunciationAssessmentProvider();
    const result = await provider.assess(providerInput);
    expect(result.outcome).toBe('SUCCESS');
    expect(provider.callCount).toBe(1);
    providerInput.canonicalAudio[0] = 9;
    expect(provider.calls[0]?.canonicalAudio[0]).toBe(1);
  });

  it('keeps every unavailable adapter fail-closed without collaborators', async () => {
    const storage = new UnavailablePronunciationAudioStorage();
    const inspector = new UnavailablePronunciationAudioInspector();
    const provider = new UnavailablePronunciationAssessmentProvider();

    await expect(storage.assertPrivateLifecycleReady()).rejects.toMatchObject({
      code: 'STORAGE_NOT_APPROVED',
    });
    await expect(inspector.assertRuntimeReady()).rejects.toMatchObject({
      code: 'AUDIO_INVALID',
    });
    await expect(provider.assess(providerInput)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
    });
  });
});
