import { Module } from '@nestjs/common';
import { LearnService } from './learn.service';
import { LearnController } from './learn.controller';
import { LearningModule } from '@libs/learning';

@Module({
  imports: [LearningModule],
  controllers: [LearnController],
  providers: [LearnService],
})
export class LearnModule {}
