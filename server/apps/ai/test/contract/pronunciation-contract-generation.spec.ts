import {
  buildPronunciationContractArtifacts,
  readPronunciationContractArtifact,
  serializePronunciationContractArtifact,
} from '@en/common/pronunciation/generate-contracts';

describe('generated pronunciation contract artifacts', () => {
  it('is deterministic and matches committed JSON artifacts', () => {
    const first = buildPronunciationContractArtifacts();
    const second = buildPronunciationContractArtifacts();

    expect(serializePronunciationContractArtifact(first)).toBe(
      serializePronunciationContractArtifact(second),
    );
    for (const [name, artifact] of Object.entries(first)) {
      expect(
        readPronunciationContractArtifact(name as keyof typeof first),
      ).toEqual(artifact);
    }
  });

  it('keeps identity, storage and raw Provider fields out of public artifacts', () => {
    const serialized = serializePronunciationContractArtifact(
      buildPronunciationContractArtifacts(),
    );

    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('objectKey');
    expect(serialized).not.toContain('bucket');
    expect(serialized).not.toContain('rawResponse');
  });
});
