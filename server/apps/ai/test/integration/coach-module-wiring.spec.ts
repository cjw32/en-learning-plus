import { AuthGuard } from '@libs/shared';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { LearningModule } from '@libs/learning';
import { AppModule } from '../../../server/src/app.module';
import { AiModule } from '../../src/ai.module';
import { ChatController } from '../../src/chat/chat.controller';
import { ChatModule } from '../../src/chat/chat.module';
import { CoachModule } from '../../src/coach/coach.module';

describe('Coach module wiring', () => {
  it('adds Coach and learning modules without replacing ChatModule', () => {
    const aiImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AiModule);
    const serverImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    );
    expect(aiImports).toEqual(
      expect.arrayContaining([ChatModule, CoachModule]),
    );
    expect(serverImports).toEqual(expect.arrayContaining([LearningModule]));
  });

  it('keeps the existing Chat route and requires authentication for all handlers', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatController)).toBe('chat');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ChatController),
    ).toEqual(expect.arrayContaining([AuthGuard]));
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ChatController.prototype.create),
    ).toBeUndefined();
  });
});
