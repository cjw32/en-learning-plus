import {
  KnowledgeCategory,
  KnowledgeDomainError,
  KnowledgeSourceStatus,
} from '../domain/knowledge.types';
import { PrismaClient } from '@libs/shared/generated/prisma/client';

export type KnowledgeSourceUsage =
  | 'embedding'
  | 'excerptDisplay'
  | 'evaluation';

export type KnowledgeSourceFieldPolicyRecord = Readonly<{
  recordType: string;
  fieldName: string;
  allowEmbedding: boolean;
  allowExcerptDisplay: boolean;
  allowEvaluation: boolean;
  contentCategory: KnowledgeCategory;
  policyVersion: string;
}>;

export type KnowledgeSourceRightsRecord = Readonly<{
  sourceKey: string;
  name: string;
  sourceType: string;
  rightsVersion: string;
  status: KnowledgeSourceStatus;
  allowEmbedding: boolean;
  allowExcerptDisplay: boolean;
  allowEvaluation: boolean;
  verifiedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  fieldPolicies: readonly KnowledgeSourceFieldPolicyRecord[];
}>;

export interface KnowledgeSourceRightsRepository {
  findBySourceKey(sourceKey: string): Promise<KnowledgeSourceRightsRecord | null>;
}

type SourceRightsPrismaClient = Pick<PrismaClient, 'knowledgeSource'>;

export class PrismaKnowledgeSourceRightsRepository
  implements KnowledgeSourceRightsRepository
{
  constructor(private readonly prisma: SourceRightsPrismaClient) {}

  async findBySourceKey(
    sourceKey: string,
  ): Promise<KnowledgeSourceRightsRecord | null> {
    const source = await this.prisma.knowledgeSource.findUnique({
      where: { sourceKey },
      include: { fieldPolicies: true },
    });
    if (!source) return null;

    return {
      sourceKey: source.sourceKey,
      name: source.name,
      sourceType: source.sourceType,
      rightsVersion: source.rightsVersion,
      status: source.status,
      allowEmbedding: source.allowEmbedding,
      allowExcerptDisplay: source.allowExcerptDisplay,
      allowEvaluation: source.allowEvaluation,
      verifiedAt: source.verifiedAt,
      validFrom: source.validFrom,
      validUntil: source.validUntil,
      fieldPolicies: source.fieldPolicies.map((policy) => ({
        recordType: policy.recordType,
        fieldName: policy.fieldName,
        allowEmbedding: policy.allowEmbedding,
        allowExcerptDisplay: policy.allowExcerptDisplay,
        allowEvaluation: policy.allowEvaluation,
        contentCategory: policy.contentCategory,
        policyVersion: policy.policyVersion,
      })),
    };
  }
}

export class InMemoryKnowledgeSourceRightsRepository
  implements KnowledgeSourceRightsRepository
{
  private readonly records: ReadonlyMap<string, KnowledgeSourceRightsRecord>;

  constructor(records: readonly KnowledgeSourceRightsRecord[]) {
    this.records = new Map(records.map((record) => [record.sourceKey, record]));
  }

  async findBySourceKey(
    sourceKey: string,
  ): Promise<KnowledgeSourceRightsRecord | null> {
    return this.records.get(sourceKey) ?? null;
  }
}

export type SourceAuthorization = Readonly<{
  sourceKey: string;
  sourceName: string;
  sourceType: string;
  rightsVersion: string;
  usage: KnowledgeSourceUsage;
  allowedFields: readonly string[];
  fieldPolicies: readonly KnowledgeSourceFieldPolicyRecord[];
}>;

const sourceUsageField: Readonly<
  Record<KnowledgeSourceUsage, keyof KnowledgeSourceRightsRecord>
> = {
  embedding: 'allowEmbedding',
  excerptDisplay: 'allowExcerptDisplay',
  evaluation: 'allowEvaluation',
};

const fieldUsageField: Readonly<
  Record<KnowledgeSourceUsage, keyof KnowledgeSourceFieldPolicyRecord>
> = {
  embedding: 'allowEmbedding',
  excerptDisplay: 'allowExcerptDisplay',
  evaluation: 'allowEvaluation',
};

function fail(code: ConstructorParameters<typeof KnowledgeDomainError>[0]): never {
  throw new KnowledgeDomainError(code);
}

export class SourceRightsService {
  constructor(private readonly repository: KnowledgeSourceRightsRepository) {}

  async authorize(input: {
    sourceKey: string;
    recordType: string;
    fieldNames: readonly string[];
    usage: KnowledgeSourceUsage;
    at?: Date;
  }): Promise<SourceAuthorization> {
    const source = await this.repository.findBySourceKey(input.sourceKey);
    if (!source) {
      fail('SOURCE_NOT_FOUND');
    }
    if (source.status !== 'ACTIVE' || !source.verifiedAt) {
      fail('SOURCE_NOT_ACTIVE');
    }

    const at = input.at ?? new Date();
    if (source.validFrom && at < source.validFrom) {
      fail('SOURCE_RIGHTS_NOT_STARTED');
    }
    if (source.validUntil && at >= source.validUntil) {
      fail('SOURCE_RIGHTS_EXPIRED');
    }
    if (source[sourceUsageField[input.usage]] !== true) {
      fail('SOURCE_USE_NOT_ALLOWED');
    }

    const requestedFields = [...new Set(input.fieldNames.map((field) => field.trim()))];
    if (requestedFields.length === 0 || requestedFields.some((field) => !field)) {
      fail('SOURCE_FIELD_NOT_ALLOWED');
    }

    const policies = requestedFields.map((fieldName) =>
      source.fieldPolicies.find(
        (policy) =>
          policy.recordType === input.recordType &&
          policy.fieldName === fieldName &&
          policy[fieldUsageField[input.usage]] === true,
      ),
    );
    if (policies.some((policy) => !policy)) {
      fail('SOURCE_FIELD_NOT_ALLOWED');
    }

    return Object.freeze({
      sourceKey: source.sourceKey,
      sourceName: source.name,
      sourceType: source.sourceType,
      rightsVersion: source.rightsVersion,
      usage: input.usage,
      allowedFields: Object.freeze(requestedFields),
      fieldPolicies: Object.freeze(
        policies.filter(
          (policy): policy is KnowledgeSourceFieldPolicyRecord => Boolean(policy),
        ),
      ),
    });
  }
}
