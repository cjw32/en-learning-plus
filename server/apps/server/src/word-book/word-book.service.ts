import { Injectable, NotFoundException } from '@nestjs/common';
import type { WordQuery } from '@en/common/word';
import { ResponseService } from '@libs/shared';
import { WordDictionaryService } from '@libs/learning';

@Injectable()
export class WordBookService {
  constructor(
    private readonly responseService: ResponseService,
    private readonly wordDictionaryService: WordDictionaryService,
  ) {}

  async findAll(query: WordQuery) {
    return this.responseService.success(
      await this.wordDictionaryService.findAll(query),
    );
  }
  async findOne(wordId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(wordId))
      throw new NotFoundException('引用内容不存在或当前不可访问');
    try {
      return this.responseService.success(
        await this.wordDictionaryService.get({ wordId }),
      );
    } catch {
      throw new NotFoundException('引用内容不存在或当前不可访问');
    }
  }
}
