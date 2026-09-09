import {
  KnowledgeOutboxRepository,
  type KnowledgeOutboxJob,
} from './knowledge-outbox.repository';

export type KnowledgeSourceRecordType =
  | 'WordBook'
  | 'Course'
  | 'LearningAttempt'
  | 'PrivateLearningSummary';

export type SourceChange = Readonly<{
  change: 'UPSERT' | 'DELETE' | 'REEMBED';
  knowledgeSourceId: string;
  recordType: KnowledgeSourceRecordType;
  recordId: string;
  contentVersion: string | null;
  pipelineVersion: string;
  ownerUserId: string | null;
}>;

export class SourceChangeService {
  constructor(private readonly outbox: KnowledgeOutboxRepository) {}

  enqueue(change: SourceChange): Promise<KnowledgeOutboxJob> {
    const isPrivate =
      change.recordType === 'LearningAttempt' ||
      change.recordType === 'PrivateLearningSummary';
    if (
      !change.knowledgeSourceId.trim() ||
      !change.recordId.trim() ||
      !change.pipelineVersion.trim() ||
      (isPrivate && !change.ownerUserId?.trim()) ||
      (!isPrivate && change.ownerUserId !== null) ||
      (change.change !== 'DELETE' && !change.contentVersion?.trim())
    ) {
      throw new Error('KNOWLEDGE_SOURCE_CHANGE_INVALID');
    }
    return this.outbox.enqueue({
      operation:
        change.change === 'DELETE'
          ? 'INVALIDATE'
          : change.change === 'REEMBED'
            ? 'REEMBED'
            : 'UPSERT',
      knowledgeSourceId: change.knowledgeSourceId,
      sourceRecordType: change.recordType,
      sourceRecordId: change.recordId,
      contentVersion: change.change === 'DELETE' ? null : change.contentVersion,
      pipelineVersion: change.pipelineVersion,
      ownerUserId: change.ownerUserId,
    });
  }
}
