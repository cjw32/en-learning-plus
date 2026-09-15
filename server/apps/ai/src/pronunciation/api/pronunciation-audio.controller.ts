import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pronunciationAssessmentIdSchema } from '@en/common/pronunciation';
import {
  AuthGuard,
  PrismaService,
  type CoachExecutionContext,
} from '@libs/shared';
import {
  PRONUNCIATION_AUDIO_STORAGE,
  type PronunciationAudioStorage,
} from '../storage/pronunciation-audio.storage';

type RequestWithContext = Request & { coachContext?: CoachExecutionContext };

export type ReadablePronunciationAudio = Readonly<{
  subjectId: string;
  objectKey: string;
  mediaType: string;
  byteSize: number;
  expiresAt: Date;
  accessRevokedAt: Date | null;
}>;

export interface PronunciationAudioAccessRepository {
  findOwnedReadableAudio(
    subjectId: string,
    assessmentId: string,
  ): Promise<ReadablePronunciationAudio | null>;
}

@Injectable()
export class PrismaPronunciationAudioAccessRepository implements PronunciationAudioAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwnedReadableAudio(subjectId: string, assessmentId: string) {
    const row = await this.prisma.pronunciationAudioAsset.findFirst({
      where: {
        assessmentId,
        userId: subjectId,
        status: 'READY',
        accessRevokedAt: null,
        purgedAt: null,
        assessment: { hiddenAt: null, deletedAt: null },
      },
      select: {
        userId: true,
        objectKey: true,
        detectedMediaType: true,
        byteSize: true,
        expiresAt: true,
        accessRevokedAt: true,
      },
    });
    return row
      ? {
          subjectId: row.userId,
          objectKey: row.objectKey,
          mediaType: row.detectedMediaType ?? 'audio/wav',
          byteSize: row.byteSize,
          expiresAt: row.expiresAt,
          accessRevokedAt: row.accessRevokedAt,
        }
      : null;
  }
}

type AudioOpenResult = Readonly<{
  statusCode: 200 | 206;
  bytes: Uint8Array;
  headers: Readonly<Record<string, string>>;
}>;

function range(
  input: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!input) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(input.trim());
  if (!match || (!match[1] && !match[2]) || size < 1) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

@Injectable()
export class PronunciationAudioAccessService {
  constructor(
    private readonly repository: PronunciationAudioAccessRepository,
    private readonly storage: Pick<PronunciationAudioStorage, 'read'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async open(
    subjectId: string,
    assessmentId: string,
    rangeHeader: string | null,
  ): Promise<AudioOpenResult | null> {
    const row = await this.repository.findOwnedReadableAudio(
      subjectId,
      assessmentId,
    );
    if (
      !row ||
      row.subjectId !== subjectId ||
      row.accessRevokedAt !== null ||
      row.expiresAt <= this.now()
    )
      return null;
    const bytes = await this.storage.read(row.objectKey).catch(() => null);
    if (!bytes || bytes.byteLength !== row.byteSize) return null;
    const selected = range(rangeHeader, bytes.byteLength);
    if (!selected) return null;
    const partial = rangeHeader !== null;
    const body = bytes.slice(selected.start, selected.end + 1);
    return Object.freeze({
      statusCode: partial ? 206 : 200,
      bytes: body,
      headers: Object.freeze({
        'Content-Type': row.mediaType,
        'Content-Length': String(body.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        ...(partial
          ? {
              'Content-Range': `bytes ${selected.start}-${selected.end}/${bytes.byteLength}`,
            }
          : {}),
      }),
    });
  }
}

@Controller({ path: 'pronunciation', version: '1' })
@UseGuards(AuthGuard)
export class PronunciationAudioController {
  constructor(private readonly audio: PronunciationAudioAccessService) {}

  @Get('assessments/:assessmentId/audio')
  async stream(
    @Req() request: RequestWithContext,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = pronunciationAssessmentIdSchema.safeParse(assessmentId);
    const subjectId = request.coachContext?.subjectId;
    const opened =
      parsed.success && subjectId
        ? await this.audio.open(subjectId, parsed.data, rangeHeader ?? null)
        : null;
    if (!opened) {
      throw new HttpException(
        {
          code: 404,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: '资源不存在或不可访问',
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    response.status(opened.statusCode);
    for (const [name, value] of Object.entries(opened.headers)) {
      response.setHeader(name, value);
    }
    return new StreamableFile(Buffer.from(opened.bytes));
  }
}
