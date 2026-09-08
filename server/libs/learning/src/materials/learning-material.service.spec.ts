import { CourseMaterialProvider } from './course-material.provider';
import { GrammarMaterialProvider } from './grammar-material.provider';
import { LearningMaterialService } from './learning-material.service';
import { WordBookMaterialProvider } from './word-book-material.provider';

describe('LearningMaterialService', () => {
  function service() {
    return new LearningMaterialService([
      new WordBookMaterialProvider({
        async searchWords() {
          return [
            {
              id: 'word-went',
              word: 'went',
              definition: 'past tense of go',
              translation: '去（过去式）',
              updatedAt: new Date('2026-09-01T00:00:00.000Z'),
            },
          ];
        },
      }),
      new CourseMaterialProvider({
        async searchOwnedCourses(subjectId) {
          return subjectId === 'user-a'
            ? [
                {
                  id: 'course-owned',
                  name: 'CET4',
                  value: 'cet4',
                  description: 'Owned vocabulary course',
                  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
                },
              ]
            : [];
        },
      }),
      new GrammarMaterialProvider(),
    ]);
  }

  it('returns stable word and owned-course citations', async () => {
    const result = await service().search('user-a', {
      query: 'went',
      materialTypes: ['word', 'course'],
      limit: 10,
    });
    expect(result.materials.map((item) => item.citation)).toEqual([
      expect.objectContaining({
        sourceId: 'word:word-went',
        materialType: 'word',
        accessScope: 'PUBLIC',
      }),
      expect.objectContaining({
        sourceId: 'course:course-owned',
        materialType: 'course',
        accessScope: 'OWNED_COURSE',
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/bocha|web_search|rag/i);
  });

  it('declares grammar unavailable rather than fabricating a source', async () => {
    const result = await service().search('user-a', {
      query: 'past tense',
      materialTypes: ['grammar'],
      limit: 10,
    });
    expect(result.materials).toEqual([]);
    expect(result.unavailableTypes).toEqual(['grammar']);
  });

  it('does not return another learner course and rejects forged citations', async () => {
    const materials = service();
    const result = await materials.search('user-b', {
      query: 'CET4',
      materialTypes: ['course'],
      limit: 10,
    });
    expect(result.materials).toEqual([]);
    expect(() =>
      materials.validateCitations(result, [
        {
          sourceId: 'grammar:forged',
          materialType: 'grammar',
          title: 'Forged',
          locator: null,
          supports: 'Unsupported',
          accessScope: 'PUBLIC',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));
  });
});
