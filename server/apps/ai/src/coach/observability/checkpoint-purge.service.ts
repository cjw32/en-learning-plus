import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export interface CoachCheckpointStore {
  deleteThread(threadId: string): Promise<void>;
}

@Injectable()
export class CheckpointPurgeService {
  constructor(private readonly store: CoachCheckpointStore) {}

  async deleteThreads(threadIds: readonly string[]): Promise<void> {
    for (const threadId of [...new Set(threadIds)]) {
      if (threadId) await this.store.deleteThread(threadId);
    }
  }
}

@Injectable()
export class LazyPostgresCheckpointStore
  implements CoachCheckpointStore, OnModuleDestroy
{
  private saver: PostgresSaver | null = null;

  constructor(private readonly config: ConfigService) {}

  async deleteThread(threadId: string): Promise<void> {
    if (!this.saver) {
      const connection = this.config.get<string>('AI_DATABASE_URL');
      if (!connection) throw new Error('AI checkpoint storage is unavailable');
      this.saver = PostgresSaver.fromConnString(connection);
    }
    await this.saver.deleteThread(threadId);
  }

  async onModuleDestroy() {
    await this.saver?.end();
  }
}
