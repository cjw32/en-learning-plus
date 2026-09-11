import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpPersistenceIdentity } from './mcp-subject.repository';

export type McpIdempotencyToolName = 'CREATE_QUIZ' | 'SUBMIT_ANSWER';

export type McpIdempotencyStatus =
  | 'RESERVED'
  | 'PROCESSING'
  | 'RECONCILING'
  | 'COMPLETED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'CANCELLED';

export type McpIdempotencyIntentRecord = Readonly<{
  id: string;
  userId: string;
  authorizationId: string;
  issuer: string;
  clientId: string;
  toolName: McpIdempotencyToolName;
  clientKeyDigest: string;
  requestFingerprint: string;
  logicalResource: string | null;
  status: McpIdempotencyStatus;
  leaseOwnerHmac: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  exerciseId?: string | null;
  submissionId?: string | null;
  learningAttemptId?: string | null;
  gradingResult?: unknown;
  gradingResultHash?: string | null;
  safeTerminalProjection: unknown;
  safeErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}>;

export type McpIdempotencyReservation = Readonly<{
  toolName: McpIdempotencyToolName;
  clientKeyDigest: string;
  requestFingerprint: string;
  logicalResource?: string;
  now: Date;
}>;

export type McpIdempotencyClaim = Readonly<{
  fromStatuses: readonly McpIdempotencyStatus[];
  toStatus: 'PROCESSING' | 'RECONCILING';
  leaseOwnerHmac: string;
  leaseExpiresAt: Date;
  requireLeaseExpired: boolean;
  now: Date;
}>;

export type McpIdempotencyTransition = Readonly<{
  fromStatuses: readonly McpIdempotencyStatus[];
  toStatus: 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'CANCELLED';
  leaseOwnerHmac?: string;
  safeTerminalProjection?: unknown;
  safeErrorCode?: string | null;
  exerciseId?: string | null;
  submissionId?: string | null;
  learningAttemptId?: string | null;
  finishedAt?: Date | null;
  now: Date;
}>;

export type McpIdempotencyGradingStage = Readonly<{
  requestFingerprint: string;
  leaseOwnerHmac: string;
  exerciseId: string;
  gradingResult: unknown;
  gradingResultHash: string;
  now: Date;
}>;

export type McpIdempotencyReservationResult = Readonly<{
  created: boolean;
  intent: McpIdempotencyIntentRecord;
}>;

export interface McpIdempotencyRepositoryPort {
  reserveOrLoad(
    identity: McpPersistenceIdentity,
    reservation: McpIdempotencyReservation,
  ): Promise<McpIdempotencyReservationResult>;
  findOwnedById(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpIdempotencyIntentRecord | null>;
  claim(
    identity: McpPersistenceIdentity,
    intentId: string,
    claim: McpIdempotencyClaim,
  ): Promise<McpIdempotencyIntentRecord | null>;
  transition(
    identity: McpPersistenceIdentity,
    intentId: string,
    transition: McpIdempotencyTransition,
  ): Promise<McpIdempotencyIntentRecord | null>;
  stageGrading?(
    identity: McpPersistenceIdentity,
    intentId: string,
    stage: McpIdempotencyGradingStage,
  ): Promise<McpIdempotencyIntentRecord | null>;
}

export class McpIdempotencyPersistenceError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor() {
    super('An idempotency record exists outside the current authorization');
    this.name = 'McpIdempotencyPersistenceError';
  }
}

function ownedIntentWhere(identity: McpPersistenceIdentity) {
  return {
    userId: identity.userId,
    authorizationId: identity.authorizationId,
    issuer: identity.issuer,
    clientId: identity.clientId,
    authorization: {
      id: identity.authorizationId,
      userId: identity.userId,
      issuer: identity.issuer,
      audience: identity.audience,
      clientId: identity.clientId,
      authorizationVersion: identity.authorizationVersion,
      status: 'ACTIVE' as const,
      subjectMapping: {
        issuer: identity.issuer,
        subjectHmac: identity.subjectHmac,
        userId: identity.userId,
        status: 'ACTIVE' as const,
      },
    },
  };
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

@Injectable()
export class McpIdempotencyRepository implements McpIdempotencyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async reserveOrLoad(
    identity: McpPersistenceIdentity,
    reservation: McpIdempotencyReservation,
  ): Promise<McpIdempotencyReservationResult> {
    try {
      const intent = await this.prisma.mcpIdempotencyIntent.create({
        data: {
          userId: identity.userId,
          authorizationId: identity.authorizationId,
          issuer: identity.issuer,
          clientId: identity.clientId,
          toolName: reservation.toolName,
          clientKeyDigest: reservation.clientKeyDigest,
          requestFingerprint: reservation.requestFingerprint,
          logicalResource: reservation.logicalResource,
          status: 'RESERVED',
          createdAt: reservation.now,
          updatedAt: reservation.now,
        },
      });
      return { created: true, intent };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const intent = await this.prisma.mcpIdempotencyIntent.findFirst({
        where: {
          ...ownedIntentWhere(identity),
          toolName: reservation.toolName,
          clientKeyDigest: reservation.clientKeyDigest,
        },
      });
      if (!intent) throw new McpIdempotencyPersistenceError();
      return { created: false, intent };
    }
  }

  findOwnedById(identity: McpPersistenceIdentity, intentId: string) {
    return this.prisma.mcpIdempotencyIntent.findFirst({
      where: { id: intentId, ...ownedIntentWhere(identity) },
    });
  }

  async claim(
    identity: McpPersistenceIdentity,
    intentId: string,
    claim: McpIdempotencyClaim,
  ) {
    const result = await this.prisma.mcpIdempotencyIntent.updateMany({
      where: {
        id: intentId,
        ...ownedIntentWhere(identity),
        status: { in: [...claim.fromStatuses] },
        ...(claim.requireLeaseExpired
          ? { leaseExpiresAt: { lte: claim.now } }
          : {}),
      },
      data: {
        status: claim.toStatus,
        leaseOwnerHmac: claim.leaseOwnerHmac,
        leaseExpiresAt: claim.leaseExpiresAt,
        attemptCount: { increment: 1 },
        updatedAt: claim.now,
      },
    });
    if (result.count !== 1) return null;
    return this.findOwnedById(identity, intentId);
  }

  async transition(
    identity: McpPersistenceIdentity,
    intentId: string,
    transition: McpIdempotencyTransition,
  ) {
    const data: Prisma.McpIdempotencyIntentUpdateManyMutationInput = {
      status: transition.toStatus,
      leaseOwnerHmac: null,
      leaseExpiresAt: null,
      updatedAt: transition.now,
      ...(transition.safeTerminalProjection !== undefined
        ? {
            safeTerminalProjection:
              transition.safeTerminalProjection as Prisma.InputJsonValue,
          }
        : {}),
      ...(transition.safeErrorCode !== undefined
        ? { safeErrorCode: transition.safeErrorCode }
        : {}),
      ...(transition.exerciseId !== undefined
        ? { exerciseId: transition.exerciseId }
        : {}),
      ...(transition.submissionId !== undefined
        ? { submissionId: transition.submissionId }
        : {}),
      ...(transition.learningAttemptId !== undefined
        ? { learningAttemptId: transition.learningAttemptId }
        : {}),
      ...(transition.finishedAt !== undefined
        ? { finishedAt: transition.finishedAt }
        : {}),
    };
    const result = await this.prisma.mcpIdempotencyIntent.updateMany({
      where: {
        id: intentId,
        ...ownedIntentWhere(identity),
        status: { in: [...transition.fromStatuses] },
        ...(transition.leaseOwnerHmac
          ? { leaseOwnerHmac: transition.leaseOwnerHmac }
          : {}),
      },
      data,
    });
    if (result.count !== 1) return null;
    return this.findOwnedById(identity, intentId);
  }

  async stageGrading(
    identity: McpPersistenceIdentity,
    intentId: string,
    stage: McpIdempotencyGradingStage,
  ) {
    const result = await this.prisma.mcpIdempotencyIntent.updateMany({
      where: {
        id: intentId,
        ...ownedIntentWhere(identity),
        toolName: 'SUBMIT_ANSWER',
        requestFingerprint: stage.requestFingerprint,
        status: 'PROCESSING',
        leaseOwnerHmac: stage.leaseOwnerHmac,
        gradingResult: { equals: Prisma.DbNull },
        gradingResultHash: null,
      },
      data: {
        exerciseId: stage.exerciseId,
        gradingResult: stage.gradingResult as Prisma.InputJsonValue,
        gradingResultHash: stage.gradingResultHash,
        updatedAt: stage.now,
      },
    });
    if (result.count !== 1) return null;
    return this.findOwnedById(identity, intentId);
  }
}
