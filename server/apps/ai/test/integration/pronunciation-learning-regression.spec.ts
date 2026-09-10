import { qualityFromScore } from '@libs/learning';
import { resolvePronunciationRuntimeConfig } from '../../src/pronunciation/governance/pronunciation-config.schema';

describe('pronunciation learning flags-off regression', () => {
  it('keeps all pronunciation mutations closed by default', () => {
    const config = resolvePronunciationRuntimeConfig({});
    expect(config.learningShadowEnabled).toBe(false);
    expect(config.learningWriteEnabled).toBe(false);
    expect(config.coachSummaryEnabled).toBe(false);
  });

  it('leaves the existing exercise score-to-quality thresholds unchanged', () => {
    expect(
      [90, 75, 60, 40, 1, 0].map((score) => qualityFromScore(score, 100)),
    ).toEqual([5, 4, 3, 2, 1, 0]);
  });
});
