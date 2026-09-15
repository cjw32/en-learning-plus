import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@libs/shared';
import { pronunciationCapabilitiesSchema } from '@en/common/pronunciation';
import { PronunciationRuntimeAdapters } from '../runtime/pronunciation-runtime.adapters';

@Controller({ path: 'pronunciation', version: '1' })
@UseGuards(AuthGuard)
export class PronunciationCapabilitiesController {
  constructor(private readonly adapters: PronunciationRuntimeAdapters) {}

  @Get('capabilities')
  async get() {
    return {
      code: 200,
      data: pronunciationCapabilitiesSchema.parse(
        await this.adapters.capabilities(),
      ),
    };
  }
}
