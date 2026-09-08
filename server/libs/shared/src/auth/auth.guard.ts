import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import {
  CoachExecutionContext,
  createCoachExecutionContext,
} from './coach-execution-context';

type AuthenticatedRequest = Request & {
  user?: { userId: string; tokenType: 'access'; exp: number };
  coachContext?: CoachExecutionContext;
};

export function parseStrictBearerToken(authorization: unknown): string {
  if (typeof authorization !== 'string') {
    throw new UnauthorizedException('请先登录');
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match?.[1]) {
    throw new UnauthorizedException('请先登录');
  }
  return match[1];
}
//守卫，用于保护路由，只有通过验证的请求才能访问路由
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>(); //获取请求对象
    const token = parseStrictBearerToken(request.headers.authorization);
    try {
      const decoded = this.jwtService.verify<Record<string, unknown>>(token);
      const coachContext = createCoachExecutionContext(decoded);
      request.user = decoded as AuthenticatedRequest['user'];
      request.coachContext = coachContext;
      return true;
    } catch {
      throw new UnauthorizedException('token已失效');
    }
  }
}
