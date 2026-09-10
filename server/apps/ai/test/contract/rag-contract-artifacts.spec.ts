import {
  buildRagContractArtifacts,
  readRagContractArtifact,
  serializeCoachContractArtifact,
} from '@en/common/coach/generate-contracts';

describe('generated RAG contract artifacts', () => {
  it('is deterministic and matches the specification artifact', () => {
    const first = buildRagContractArtifacts();
    const second = buildRagContractArtifacts();
    expect(serializeCoachContractArtifact(first)).toBe(
      serializeCoachContractArtifact(second),
    );
    for (const [name, artifact] of Object.entries(first)) {
      expect(readRagContractArtifact(name as keyof typeof first)).toEqual(
        artifact,
      );
    }
    const serialized = serializeCoachContractArtifact(first);
    expect(serialized).not.toContain('userId');
    expect(first['coach-result-v2.schema.json']).toMatchObject({
      title: 'CoachResultV2',
    });
    expect(first['coach-rag.openapi.yaml']).toMatchObject({
      openapi: '3.1.0',
      paths: { '/coach/citations/{citationId}': expect.any(Object) },
    });
  });
});
