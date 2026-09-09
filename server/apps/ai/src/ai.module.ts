import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatModule } from './chat/chat.module';
import { PromptModule } from './prompt/prompt.module';
import { SharedModule } from '@libs/shared';
import { DigestModule } from './digest/digest.module';
import { CoachModule } from './coach/coach.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
@Module({
  imports: [
    ChatModule,
    PromptModule,
    SharedModule,
    DigestModule,
    CoachModule,
    KnowledgeModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
