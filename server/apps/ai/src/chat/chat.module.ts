import { AuthGuard } from '@libs/shared';
import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  controllers: [ChatController],
  providers: [ChatService, AuthGuard],
})
export class ChatModule {}
