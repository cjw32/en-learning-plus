import { StreamableFile, HttpException } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { InterceptorInterceptor } from '@libs/shared/interceptor/interceptor';
import { InterceptorExceptionFilter } from '@libs/shared/interceptor/exceptionFilter';

describe('pronunciation responses through global HTTP middleware', () => {
  const context = { switchToHttp: () => ({ getRequest: () => ({url:'/ai/v1/pronunciation/assessments/test/audio'}) }) } as never;
  it.each([Buffer.from('RIFF'), new StreamableFile(Buffer.from('RIFF'))])('keeps binary playback intact', async value => {
    expect(await lastValueFrom(new InterceptorInterceptor().intercept(context, {handle: () => of(value)}))).toBe(value);
  });
  it('does not add transport fields to strict pronunciation response contracts', async () => {
    const envelope = {code:201,data:{assessmentId:'test'}};
    expect(await lastValueFrom(new InterceptorInterceptor().intercept(context, {handle: () => of(envelope)}))).toBe(envelope);
  });
  it('preserves the validated public error envelope and excludes arbitrary details', () => {
    const json = jest.fn(); const status = jest.fn().mockReturnValue({json});
    const host = { switchToHttp: () => ({getRequest: () => ({url:'/test'}), getResponse: () => ({status})}) } as never;
    const body = {code:400,error:{code:'AUDIO_INVALID',category:'AUDIO',message:'录音无法处理，请重新录制。',retryable:true,retryAfterSeconds:null,assessmentId:null,traceId:null}};
    new InterceptorExceptionFilter().catch(new HttpException(body,400),host);
    expect(json).toHaveBeenCalledWith(body);
    json.mockClear();
    new InterceptorExceptionFilter().catch(new HttpException({...body,secret:'never return'},400),host);
    expect(JSON.stringify(json.mock.calls)).not.toContain('never return');
  });
});
