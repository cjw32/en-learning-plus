import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  HttpException,
  Param,
  Optional,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  coachFeedbackInputSchema,
  coachProfileUpdateSchema,
  createCoachConversationSchema,
  createCoachRequestSchema,
  idempotencyKeySchema,
  deleteCoachDataSchema,
  citationIdSchema,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import {
  AuthGuard,
  CoachExecutionContext,
} from '@libs/shared';
import type { Request } from 'express';
import type { Response } from 'express';
import { CoachApiService } from './coach-api.service';
import { CoachAdmissionService } from '../governance/coach-admission.service';

type CoachRequest = Request & { coachContext?: CoachExecutionContext };

const listQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const detailQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('请求参数无效');
  return result.data;
}

function contextFrom(request: CoachRequest): CoachExecutionContext {
  if (!request.coachContext) throw new BadRequestException('认证上下文无效');
  return request.coachContext;
}

@Controller({ path: 'coach', version: '1' })
@UseGuards(AuthGuard)
export class CoachController {
  constructor(
    private readonly api: CoachApiService,
    @Optional() private readonly admission?: CoachAdmissionService,
  ) {}

  @Get('profile')
  getProfile(@Req() request: CoachRequest) {
    return this.api.getProfile(contextFrom(request));
  }

  @Patch('profile')
  updateProfile(
    @Req() request: CoachRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.api.updateProfile(
      contextFrom(request),
      parse(coachProfileUpdateSchema, body),
      parse(idempotencyKeySchema, key),
    );
  }

  @Post('conversations')
  createConversation(
    @Req() request: CoachRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.api.createConversation(
      contextFrom(request),
      parse(createCoachConversationSchema, body ?? {}),
      parse(idempotencyKeySchema, key),
    );
  }

  @Get('conversations')
  listConversations(
    @Req() request: CoachRequest,
    @Query() query: unknown,
  ) {
    return this.api.listConversations(
      contextFrom(request),
      parse(listQuerySchema, query),
    );
  }

  @Get('conversations/:conversationId')
  getConversation(
    @Req() request: CoachRequest,
    @Param('conversationId') conversationId: string,
    @Query() query: unknown,
  ) {
    return this.api.getConversation(
      contextFrom(request),
      conversationId,
      parse(detailQuerySchema, query),
    );
  }

  @Delete('conversations/:conversationId')
  @HttpCode(HttpStatus.ACCEPTED)
  deleteConversation(
    @Req() request: CoachRequest,
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.api.deleteConversation(
      contextFrom(request),
      conversationId,
      parse(idempotencyKeySchema, key),
    );
  }

  @Post('conversations/:conversationId/requests')
  @HttpCode(HttpStatus.ACCEPTED)
  async createRequest(
    @Req() request: CoachRequest,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    try {
      await this.admission?.consumeIp(request.ip);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'RATE_LIMITED') {
        throw new HttpException('请求过于频繁，请稍后再试。', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new ServiceUnavailableException('Coach 请求治理暂时不可用');
    }
    return this.api.createRequest(
      contextFrom(request),
      conversationId,
      parse(createCoachRequestSchema, body),
      parse(idempotencyKeySchema, key),
    );
  }

  @Get('requests/:requestId')
  getRequest(
    @Req() request: CoachRequest,
    @Param('requestId') requestId: string,
  ) {
    return this.api.getRequest(contextFrom(request), requestId);
  }

  @Get('citations/:citationId')
  getCitation(
    @Req() request: CoachRequest,
    @Param('citationId') citationId: string,
  ) {
    return this.api.getCitation(
      contextFrom(request),
      parse(citationIdSchema, citationId),
    );
  }

  @Post('requests/:requestId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancelRequest(
    @Req() request: CoachRequest,
    @Param('requestId') requestId: string,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.api.cancelRequest(
      contextFrom(request),
      requestId,
      parse(idempotencyKeySchema, key),
    );
  }

  @Post('requests/:requestId/retry')
  async retryRequest(
    @Req() request: CoachRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('requestId') requestId: string,
    @Headers('idempotency-key') key: unknown,
  ) {
    const result = await this.api.retryRequest(
      contextFrom(request),
      requestId,
      parse(idempotencyKeySchema, key),
    );
    response.status(result.data.status === 'QUEUED' ? 202 : 200);
    return result;
  }

  @Put('requests/:requestId/feedback')
  upsertFeedback(
    @Req() request: CoachRequest,
    @Param('requestId') requestId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.api.upsertFeedback(
      contextFrom(request),
      requestId,
      parse(idempotencyKeySchema, key),
      parse(coachFeedbackInputSchema, body),
    );
  }

  @Delete('data')
  @HttpCode(HttpStatus.ACCEPTED)
  deleteCoachData(
    @Req() request: CoachRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    parse(deleteCoachDataSchema, body);
    return this.api.deleteCoachData(
      contextFrom(request),
      parse(idempotencyKeySchema, key),
    );
  }
}
