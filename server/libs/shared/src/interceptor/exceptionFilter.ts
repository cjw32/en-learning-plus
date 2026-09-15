import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { pronunciationErrorResponseSchema } from '@en/common/pronunciation';

@Catch(HttpException)
export class InterceptorExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();
    const pronunciation = pronunciationErrorResponseSchema.safeParse(exception.getResponse());
    if (pronunciation.success && pronunciation.data.code === exception.getStatus()) {
      response.status(exception.getStatus()).json(pronunciation.data);
      return;
    }
    response.status(exception.getStatus()).json({
      timestamp: new Date().toISOString(),
      path: request.url,
      message: exception.message,
      code: exception.getStatus(),
      success: false,
    });
  }
}
