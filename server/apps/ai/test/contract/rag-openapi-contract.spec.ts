import {
  buildRagContractArtifacts,
  serializeCoachContractArtifact,
} from '@en/common/coach/generate-contracts';
import { citationIdSchema } from '@en/common/coach';

describe('RAG citation OpenAPI contract', () => {
  const artifact = buildRagContractArtifacts()['coach-rag.openapi.yaml'];

  it('publishes a bearer-authenticated, subject-free citation resolver', () => {
    expect(artifact).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/coach/citations/{citationId}': {
          get: {
            operationId: 'getCoachCitation',
            security: [{ bearerAuth: [] }],
          },
        },
      },
    });
    expect(serializeCoachContractArtifact(artifact)).not.toMatch(
      /userId|ownerUserId|documentId|chunkId/,
    );
  });

  it('uses the same opaque citation ID boundary as the runtime', () => {
    expect(citationIdSchema.safeParse('cit_public_00000001').success).toBe(true);
    expect(citationIdSchema.safeParse('../../private').success).toBe(false);
    expect(citationIdSchema.safeParse('https://evil.example').success).toBe(false);
  });
});
