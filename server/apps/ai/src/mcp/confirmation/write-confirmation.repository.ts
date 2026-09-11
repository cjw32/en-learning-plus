import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';

export type McpWriteConfirmationState =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CLAIMED'
  | 'CONSUMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED';

export type McpWriteConfirmationRecord = Readonly<{
  id: string;
  selectorHmac: string;
  idempotencyIntentId: string;
  userId: string;
  authorizationId: string;
  issuer: string;
  clientId: string;
  requiredScope: 'answer:submit';
  scopeSnapshotDigest: string;
  toolVersion: string;
  exerciseId: string;
  exerciseVersion: string;
  answerDigest: string;
  operationSummary: unknown;
  operationSummaryVersion: string;
  operationSummaryDigest: string;
  state: McpWriteConfirmationState;
  expiresAt: Date;
  confirmedAt: Date | null;
  claimedAt: Date | null;
  consumedAt: Date | null;
  confirmingWebUserIdHmac: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type McpWriteConfirmationCreate = McpWriteConfirmationRecord;

export type McpWriteConfirmationTransition = Readonly<{
  fromStates: readonly McpWriteConfirmationState[];
  toState: McpWriteConfirmationState;
  now: Date;
  requireUnexpiredAt?: Date;
  expected?: Readonly<{
    idempotencyIntentId?: string;
    authorizationId?: string;
    issuer?: string;
    clientId?: string;
    scopeSnapshotDigest?: string;
    exerciseId?: string;
    exerciseVersion?: string;
    answerDigest?: string;
    operationSummaryDigest?: string;
  }>;
  confirmedAt?: Date;
  claimedAt?: Date;
  consumedAt?: Date;
  confirmingWebUserIdHmac?: string;
}>;

export type McpConfirmationOwner = Pick<McpPersistenceIdentity, 'userId'> &
  Partial<
    Pick<
      McpPersistenceIdentity,
      | 'authorizationId'
      | 'issuer'
      | 'subjectHmac'
      | 'clientId'
      | 'audience'
      | 'authorizationVersion'
    >
  >;

export interface WriteConfirmationRepositoryPort {
  createScoped(
    identity: McpPersistenceIdentity,
    input: McpWriteConfirmationCreate,
  ): Promise<McpWriteConfirmationRecord>;
  findOwnedBySelector(
    userId: string,
    selectorHmac: string,
  ): Promise<McpWriteConfirmationRecord | null>;
  findOwnedByIntent(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpWriteConfirmationRecord | null>;
  findOwnedById(
    identity: McpPersistenceIdentity,
    confirmationId: string,
  ): Promise<McpWriteConfirmationRecord | null>;
  transitionOwned(
    owner: McpConfirmationOwner,
    confirmationId: string,
    transition: McpWriteConfirmationTransition,
  ): Promise<McpWriteConfirmationRecord | null>;
}

export class WriteConfirmationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'RESOURCE_NOT_FOUND'
      | 'CONFIRMATION_STATE_CONFLICT'
      | 'VALIDATION_FAILED',
  ) {
    super('The confirmation record could not be persisted.');
    this.name = 'WriteConfirmationPersistenceError';
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

function assertDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new WriteConfirmationPersistenceError('VALIDATION_FAILED');
  }
}

function activeAuthorizationWhere(owner: McpConfirmationOwner) {
  return {
    status: 'ACTIVE' as const,
    userId: owner.userId,
    ...(owner.authorizationId ? { id: owner.authorizationId } : {}),
    ...(owner.issuer ? { issuer: owner.issuer } : {}),
    ...(owner.clientId ? { clientId: owner.clientId } : {}),
    ...(owner.audience ? { audience: owner.audience } : {}),
    ...(owner.authorizationVersion !== undefined
      ? { authorizationVersion: owner.authorizationVersion }
      : {}),
    ...(owner.subjectHmac && owner.issuer
      ? {
          subjectMapping: {
            issuer: owner.issuer,
            subjectHmac: owner.subjectHmac,
            userId: owner.userId,
            status: 'ACTIVE' as const,
          },
        }
      : {}),
  };
}

function ownedConfirmationWhere(owner: McpConfirmationOwner) {
  return {
    userId: owner.userId,
    ...(owner.authorizationId
      ? { authorizationId: owner.authorizationId }
      : {}),
    ...(owner.issuer ? { issuer: owner.issuer } : {}),
    ...(owner.clientId ? { clientId: owner.clientId } : {}),
    authorization: activeAuthorizationWhere(owner),
  };
}

@Injectable()
export class WriteConfirmationRepository implements WriteConfirmationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createScoped(
    identity: McpPersistenceIdentity,
    input: McpWriteConfirmationCreate,
  ): Promise<McpWriteConfirmationRecord> {
    assertDate(input.expiresAt);
    assertDate(input.createdAt);
    assertDate(input.updatedAt);
    if (
      input.userId !== identity.userId ||
      input.authorizationId !== identity.authorizationId ||
      input.issuer !== identity.issuer ||
      input.clientId !== identity.clientId ||
      input.requiredScope !== 'answer:submit' ||
      input.state !== 'PENDING'
    ) {
      throw new WriteConfirmationPersistenceError('VALIDATION_FAILED');
    }

    try {
      return await this.prisma.$transaction(async (database) => {
        const intent = await database.mcpIdempotencyIntent.findFirst({
          where: {
            id: input.idempotencyIntentId,
            userId: identity.userId,
            authorizationId: identity.authorizationId,
            issuer: identity.issuer,
            clientId: identity.clientId,
            toolName: 'SUBMIT_ANSWER',
            exerciseId: input.exerciseId,
            authorization: activeAuthorizationWhere(identity),
          },
          select: { id: true },
        });
        if (!intent) {
          throw new WriteConfirmationPersistenceError('RESOURCE_NOT_FOUND');
        }
        const exercise = await database.exercise.findFirst({
          where: { id: input.exerciseId, userId: identity.userId },
          select: { id: true },
        });
        if (!exercise) {
          throw new WriteConfirmationPersistenceError('RESOURCE_NOT_FOUND');
        }
        return database.mcpWriteConfirmation.create({
          data: {
            id: input.id,
            selectorHmac: input.selectorHmac,
            idempotencyIntentId: input.idempotencyIntentId,
            userId: input.userId,
            authorizationId: input.authorizationId,
            issuer: input.issuer,
            clientId: input.clientId,
            requiredScope: input.requiredScope,
            scopeSnapshotDigest: input.scopeSnapshotDigest,
            toolVersion: input.toolVersion,
            exerciseId: input.exerciseId,
            exerciseVersion: input.exerciseVersion,
            answerDigest: input.answerDigest,
            operationSummary: input.operationSummary as Prisma.InputJsonValue,
            operationSummaryVersion: input.operationSummaryVersion,
            operationSummaryDigest: input.operationSummaryDigest,
            state: input.state,
            expiresAt: input.expiresAt,
            confirmedAt: input.confirmedAt,
            claimedAt: input.claimedAt,
            consumedAt: input.consumedAt,
            confirmingWebUserIdHmac: input.confirmingWebUserIdHmac,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
        }) as Promise<McpWriteConfirmationRecord>;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new WriteConfirmationPersistenceError(
          'CONFIRMATION_STATE_CONFLICT',
        );
      }
      throw error;
    }
  }

  findOwnedBySelector(
    userId: string,
    selectorHmac: string,
  ): Promise<McpWriteConfirmationRecord | null> {
    return this.prisma.mcpWriteConfirmation.findFirst({
      where: {
        selectorHmac,
        ...ownedConfirmationWhere({ userId }),
      },
    }) as Promise<McpWriteConfirmationRecord | null>;
  }

  findOwnedByIntent(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpWriteConfirmationRecord | null> {
    return this.prisma.mcpWriteConfirmation.findFirst({
      where: {
        idempotencyIntentId: intentId,
        ...ownedConfirmationWhere(identity),
      },
    }) as Promise<McpWriteConfirmationRecord | null>;
  }

  findOwnedById(
    identity: McpPersistenceIdentity,
    confirmationId: string,
  ): Promise<McpWriteConfirmationRecord | null> {
    return this.prisma.mcpWriteConfirmation.findFirst({
      where: {
        id: confirmationId,
        ...ownedConfirmationWhere(identity),
      },
    }) as Promise<McpWriteConfirmationRecord | null>;
  }

  async transitionOwned(
    owner: McpConfirmationOwner,
    confirmationId: string,
    transition: McpWriteConfirmationTransition,
  ): Promise<McpWriteConfirmationRecord | null> {
    assertDate(transition.now);
    if (transition.fromStates.length === 0) {
      throw new WriteConfirmationPersistenceError('VALIDATION_FAILED');
    }
    if (transition.requireUnexpiredAt)
      assertDate(transition.requireUnexpiredAt);

    const result = await this.prisma.mcpWriteConfirmation.updateMany({
      where: {
        id: confirmationId,
        ...ownedConfirmationWhere(owner),
        state: { in: [...transition.fromStates] },
        ...(transition.requireUnexpiredAt
          ? { expiresAt: { gt: transition.requireUnexpiredAt } }
          : {}),
        ...(transition.expected ?? {}),
      },
      data: {
        state: transition.toState,
        updatedAt: transition.now,
        ...(transition.confirmedAt
          ? { confirmedAt: transition.confirmedAt }
          : {}),
        ...(transition.claimedAt ? { claimedAt: transition.claimedAt } : {}),
        ...(transition.consumedAt ? { consumedAt: transition.consumedAt } : {}),
        ...(transition.confirmingWebUserIdHmac
          ? {
              confirmingWebUserIdHmac: transition.confirmingWebUserIdHmac,
            }
          : {}),
      },
    });
    if (result.count !== 1) return null;
    return this.prisma.mcpWriteConfirmation.findFirst({
      where: { id: confirmationId, ...ownedConfirmationWhere(owner) },
    }) as Promise<McpWriteConfirmationRecord | null>;
  }
}
