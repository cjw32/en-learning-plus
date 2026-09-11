import { NestFactory } from '@nestjs/core';
import { AiModule } from './ai.module';
import { InterceptorInterceptor } from '@libs/shared/interceptor/interceptor';
import { InterceptorExceptionFilter } from '@libs/shared/interceptor/exceptionFilter';
import { config } from '@en/config';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { mountMcpHttpBoundary } from './mcp/transport/mcp-http-boundary';
async function bootstrap() {
  const app = await NestFactory.create(AiModule);
  mountMcpHttpBoundary(app);
  app.useGlobalInterceptors(new InterceptorInterceptor());
  app.useGlobalFilters(new InterceptorExceptionFilter());
  app.setGlobalPrefix('ai', {
    exclude: [
      {
        path: '.well-known/oauth-protected-resource/ai/v1/mcp',
        method: RequestMethod.GET,
      },
    ],
  }); //设置全局前缀
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.listen(config.ports.ai);
}
void bootstrap();
