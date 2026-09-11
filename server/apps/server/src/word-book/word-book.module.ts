import { Module } from '@nestjs/common';
import { LearningModule } from '@libs/learning';
import { WordBookService } from './word-book.service';
import { WordBookController } from './word-book.controller';

@Module({
  imports: [LearningModule],
  controllers: [WordBookController],
  providers: [WordBookService],
})
export class WordBookModule {}
