import { Injectable } from '@nestjs/common';
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
}
