import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationSafeErrorSchema,
} from '@en/common/mcp';
import { AuthGuard } from '@libs/shared';
import type { Request, Response } from 'express';
import {
  WriteConfirmationError,
  WriteConfirmationService,
} from './write-confirmation.service';

export const MCP_CONFIRMATION_CONTROLLER_OPTIONS = Symbol(
  'MCP_CONFIRMATION_CONTROLLER_OPTIONS',
);

export type McpConfirmationControllerOptions = Readonly<{
  csrfHmacKey: string;
  csrfTtlMs: number;
}>;

type AuthenticatedWebRequest = Request & {
  user?: Readonly<{
    userId: string;
    tokenType: 'access';
    exp: number;
    iat?: number;
  }>;
};

type AuthenticatedWebUser = Readonly<{
  userId: string;
  tokenType: 'access';
  exp: number;
  iat: number;
}>;

const CSRF_COOKIE = 'mcp_confirmation_csrf';

function safeHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

@Controller({ path: 'mcp/confirmations', version: '1' })
@UseGuards(AuthGuard)
export class WriteConfirmationController {
  constructor(
    private readonly confirmations: WriteConfirmationService,
    @Inject(MCP_CONFIRMATION_CONTROLLER_OPTIONS)
    private readonly options: McpConfirmationControllerOptions,
  ) {
    if (
      Buffer.byteLength(options.csrfHmacKey, 'utf8') < 32 ||
      !Number.isSafeInteger(options.csrfTtlMs) ||
      options.csrfTtlMs < 1 ||
      options.csrfTtlMs > 5 * 60 * 1_000
    ) {
      throw new Error('Invalid MCP confirmation controller options');
    }
  }

  @Get(':selector')
  async get(
    @Req() request: AuthenticatedWebRequest,
    @Param('selector') selector: string,
    @Res() response: Response,
  ): Promise<void> {
    safeHeaders(response);
    try {
      const user = this.authenticatedUser(request);
      const view = await this.confirmations.getWeb(selector, user.userId);
      const csrf = this.issueCsrf(user.userId, selector, Date.now());
      response.setHeader('X-MCP-CSRF-Token', csrf);
      response.setHeader(
        'Set-Cookie',
        `${CSRF_COOKIE}=${csrf}; Path=/ai/v1/mcp/confirmations; Max-Age=${Math.ceil(
          this.options.csrfTtlMs / 1_000,
        )}; Secure; SameSite=Strict`,
      );
      response.status(200).json(view);
    } catch (error) {
      this.sendError(response, error);
    }
  }

  @Post(':selector')
  async decide(
    @Req() request: AuthenticatedWebRequest,
    @Param('selector') selector: string,
    @Headers('x-mcp-csrf-token') csrfHeader: unknown,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    safeHeaders(response);
    try {
      const user = this.authenticatedUser(request);
      const csrfCookie = cookieValue(request.headers.cookie, CSRF_COOKIE);
      const csrfVerified =
        typeof csrfHeader === 'string' &&
        csrfCookie !== null &&
        safeEqual(csrfHeader, csrfCookie) &&
        this.verifyCsrf(csrfHeader, user.userId, selector, Date.now());
      const result = await this.confirmations.decideWeb(
        selector,
        {
          userId: user.userId,
          sessionUserId: user.userId,
          reauthenticatedAt: new Date(user.iat * 1_000),
          tokenExpiresAt: new Date(user.exp * 1_000),
          csrfVerified,
          csrfReplayDetected: false,
        },
        body,
      );
      response.status(200).json(result);
    } catch (error) {
      this.sendError(response, error);
    }
  }

  private authenticatedUser(
    request: AuthenticatedWebRequest,
  ): AuthenticatedWebUser {
    const user = request.user;
    if (
      !user ||
      user.tokenType !== 'access' ||
      typeof user.userId !== 'string' ||
      user.userId.length < 1 ||
      typeof user.iat !== 'number' ||
      !Number.isInteger(user.iat) ||
      !Number.isInteger(user.exp)
    ) {
      throw new WriteConfirmationError('UNAUTHENTICATED');
    }
    return user;
  }

  private issueCsrf(userId: string, selector: string, nowMs: number): string {
    const nonce = randomBytes(16).toString('base64url');
    const payload = `${nowMs}.${nonce}`;
    const signature = createHmac('sha256', this.options.csrfHmacKey)
      .update(
        `mcp-confirmation-csrf\u0000${userId}\u0000${selector}\u0000${payload}`,
      )
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private verifyCsrf(
    token: string,
    userId: string,
    selector: string,
    nowMs: number,
  ): boolean {
    const match =
      /^(\d{13})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,64})$/u.exec(token);
    if (!match) return false;
    const issuedAt = Number(match[1]);
    if (
      !Number.isSafeInteger(issuedAt) ||
      issuedAt > nowMs ||
      nowMs - issuedAt > this.options.csrfTtlMs
    ) {
      return false;
    }
    const payload = `${match[1]}.${match[2]}`;
    const expected = createHmac('sha256', this.options.csrfHmacKey)
      .update(
        `mcp-confirmation-csrf\u0000${userId}\u0000${selector}\u0000${payload}`,
      )
      .digest('base64url');
    return safeEqual(match[3], expected);
  }

  private sendError(response: Response, error: unknown): void {
    const code =
      error instanceof WriteConfirmationError
        ? error.code
        : 'CONFIRMATION_STATE_CONFLICT';
    const status =
      code === 'UNAUTHENTICATED'
        ? 401
        : code === 'RESOURCE_NOT_FOUND'
          ? 404
          : code === 'VALIDATION_FAILED'
            ? 400
            : code === 'CONFIRMATION_EXPIRED'
              ? 410
              : 409;
    response.status(status).json(
      mcpConfirmationSafeErrorSchema.parse({
        schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
        code,
        message: 'The confirmation request could not be completed.',
      }),
    );
  }
}
