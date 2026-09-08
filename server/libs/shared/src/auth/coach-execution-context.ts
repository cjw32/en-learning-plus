import { UnauthorizedException } from '@nestjs/common';

export type CoachAccessTokenClaims = {
  userId: string;
  tokenType: 'access';
  exp: number;
};

export class CoachExecutionContext {
  readonly subjectId: string;
  readonly accessTokenExpiresAtEpochSeconds: number;

  constructor(subjectId: string, accessTokenExpiresAtEpochSeconds: number) {
    this.subjectId = subjectId;
    this.accessTokenExpiresAtEpochSeconds = accessTokenExpiresAtEpochSeconds;
    Object.freeze(this);
  }
}

export function createCoachExecutionContext(
  claims: unknown,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): CoachExecutionContext {
  if (!claims || typeof claims !== 'object') {
    throw new UnauthorizedException('token已失效');
  }
  const candidate = claims as Record<string, unknown>;
  if (
    candidate.tokenType !== 'access' ||
    typeof candidate.userId !== 'string' ||
    candidate.userId.trim().length === 0 ||
    typeof candidate.exp !== 'number' ||
    !Number.isInteger(candidate.exp) ||
    candidate.exp <= nowEpochSeconds
  ) {
    throw new UnauthorizedException('token已失效');
  }
  return new CoachExecutionContext(candidate.userId, candidate.exp);
}
