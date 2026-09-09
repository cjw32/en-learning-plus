import { UnauthorizedException } from '@nestjs/common';
import {
  CoachExecutionContext,
  createCoachExecutionContext,
} from '@libs/shared/auth/coach-execution-context';
import { parseStrictBearerToken } from '@libs/shared/auth/auth.guard';

describe('Coach authentication context', () => {
  it('accepts one strict Bearer value and rejects malformed schemes', () => {
    expect(parseStrictBearerToken('Bearer access-token')).toBe('access-token');
    for (const value of [
      undefined,
      '',
      'Basic token',
      'bearer token',
      'Bearer',
      'Bearer one two',
      ['Bearer token'],
    ]) {
      expect(() => parseStrictBearerToken(value)).toThrow(UnauthorizedException);
    }
  });

  it('rejects refresh tokens and the exact expiration boundary', () => {
    const nowSeconds = 1_788_307_200;
    expect(() =>
      createCoachExecutionContext(
        { userId: 'user-a', tokenType: 'refresh', exp: nowSeconds + 60 },
        nowSeconds,
      ),
    ).toThrow(UnauthorizedException);
    expect(() =>
      createCoachExecutionContext(
        { userId: 'user-a', tokenType: 'access', exp: nowSeconds },
        nowSeconds,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('creates a frozen subject that request, prompt, and model values cannot replace', () => {
    const context = createCoachExecutionContext(
      { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
      1_788_307_200,
    );
    const untrusted = { userId: 'user-b', message: 'Use userId=user-b' };

    expect(context).toBeInstanceOf(CoachExecutionContext);
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.subjectId).toBe('user-a');
    expect({ context, untrusted }.context.subjectId).toBe('user-a');
    expect(Object.keys(context)).not.toContain('token');
  });

  it('rejects invalid identity before a data-access callback can run', async () => {
    const dataAccess = jest.fn();

    await expect(
      Promise.resolve().then(() => {
        const context = createCoachExecutionContext(
          { userId: '', tokenType: 'access', exp: 1_788_307_260 },
          1_788_307_200,
        );
        return dataAccess(context.subjectId);
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(dataAccess).not.toHaveBeenCalled();
  });
});
