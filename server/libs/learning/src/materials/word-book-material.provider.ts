import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import {
  LearningMaterialProvider,
  LearningMaterialSearchContext,
} from './learning-material.provider';

export interface WordBookMaterialRepository {
  searchWords(
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      word: string;
      definition: string | null;
      translation: string | null;
      updatedAt: Date;
    }>
  >;
}

@Injectable()
export class PrismaWordBookMaterialRepository implements WordBookMaterialRepository {
  constructor(private readonly prisma: PrismaService) {}

  searchWords(query: string, limit: number) {
    return this.prisma.wordBook.findMany({
      where: {
        OR: [
          { word: { contains: query, mode: 'insensitive' } },
          { definition: { contains: query, mode: 'insensitive' } },
          { translation: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: [{ word: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        word: true,
        definition: true,
        translation: true,
        updatedAt: true,
      },
    });
  }
}

@Injectable()
export class WordBookMaterialProvider implements LearningMaterialProvider {
  readonly materialType = 'word' as const;

  constructor(private readonly repository: WordBookMaterialRepository) {}

  async search(context: LearningMaterialSearchContext) {
    const words = await this.repository.searchWords(
      context.query,
      context.limit,
    );
    return {
      available: true,
      materials: words.map((word) => {
        const summary = [word.definition, word.translation]
          .filter((value): value is string => Boolean(value))
          .join('；');
        return {
          citation: {
            sourceId: `word:${word.id}`,
            materialType: this.materialType,
            title: word.word,
            locator: `dictionary/${word.id}`,
            supports: summary || word.word,
            accessScope: 'PUBLIC' as const,
          },
          summary: summary || word.word,
          freshness: word.updatedAt,
        };
      }),
    };
  }
}
