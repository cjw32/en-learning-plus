import { Controller, Get, Query, Param } from '@nestjs/common';
import { WordBookService } from './word-book.service';
import type { WordQuery } from '@en/common/word';
@Controller('word-book')
export class WordBookController {
  constructor(private readonly wordBookService: WordBookService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.wordBookService.findOne(id);
  }

  @Get()
  findAll(@Query() query: WordQuery) {
    return this.wordBookService.findAll(query);
  }
}
