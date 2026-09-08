import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { resolveCoachRuntimeConfig } from './coach-config.schema';

export function assertCoachEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  try {
    if (!resolveCoachRuntimeConfig(environment).enabled) {
      throw new ServiceUnavailableException('Coach 功能尚未启用');
    }
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException('Coach 功能配置无效');
  }
}

@Injectable()
export class CoachEnabledGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    assertCoachEnabled();
    return true;
  }
}
