import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

// 将bigint转换为字符串，并保留日期类型不变
const transformBigInt = (obj: any) => {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(transformBigInt);
  }
  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) {
      return obj;
    }
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, transformBigInt(value)]),
    );
  }
  return obj;
};

@Injectable()
export class InterceptorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    return next.handle().pipe(
      map((data) => {
        if (Buffer.isBuffer(data) || data instanceof StreamableFile) return data;
        // Pronunciation already supplies its versioned, strictly validated envelope.
        if (/^\/ai\/v1\/pronunciation(?:\/|\?|$)/.test(request.url)) return data;
        return {
          timestamp: new Date().toISOString(),
          path: request.url,
          message: data?.message || '请求成功',
          code: data?.code || 200,
          success: true,
          data: transformBigInt(data?.data) ?? null,
        };
      }),
    );
  }
}
