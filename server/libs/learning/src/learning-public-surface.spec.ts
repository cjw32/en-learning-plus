import {
  LearningModule,
  LearningReportService,
  LearningResourceReadService,
  WordDictionaryService,
} from './index';

describe('Learning library public service surface', () => {
  it('exports the module and the three reusable read facades', () => {
    expect(LearningModule).toBeDefined();
    expect(WordDictionaryService).toBeDefined();
    expect(LearningResourceReadService).toBeDefined();
    expect(LearningReportService).toBeDefined();
  });
});
