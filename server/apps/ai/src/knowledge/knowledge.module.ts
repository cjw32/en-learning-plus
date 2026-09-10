import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  EmbeddingGateway,
  LearningModule,
  PrismaCitationRepository,
  PrismaKnowledgeVectorRepository,
  RAG_LEARNING_MATERIAL_SEARCH,
} from '@libs/learning';
import { resolveRagRuntimeConfig } from '../coach/governance/coach-config.schema';
import { HttpEmbeddingGateway } from './embedding/http-embedding.gateway';
import {
  KNOWLEDGE_INGESTION_QUEUE,
  KnowledgeOutboxDispatcher,
} from './queue/knowledge-outbox.dispatcher';
import { KnowledgeIngestionProcessor } from './queue/knowledge-ingestion.processor';
import { RagLearningMaterialSearchService } from './retrieval/rag-learning-material-search.service';

export const RAG_RUNTIME_CONFIG = Symbol('RAG_RUNTIME_CONFIG');
export const RAG_EMBEDDING_GATEWAY = Symbol('RAG_EMBEDDING_GATEWAY');

class DisabledEmbeddingGateway implements EmbeddingGateway {
  embed(): Promise<never> {
    return Promise.reject(new Error('EMBEDDING_PROVIDER_UNAPPROVED'));
  }
}

@Module({
  imports: [
    LearningModule,
    BullModule.registerQueue({ name: KNOWLEDGE_INGESTION_QUEUE }),
  ],
  providers: [
    {
      provide: RAG_RUNTIME_CONFIG,
      useFactory: () => resolveRagRuntimeConfig(process.env),
    },
    {
      provide: RAG_EMBEDDING_GATEWAY,
      inject: [RAG_RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof resolveRagRuntimeConfig>) => {
        if (!config.embeddingProviderApproved) {
          return new DisabledEmbeddingGateway();
        }
        return new HttpEmbeddingGateway({
          approved: config.embeddingProviderApproved,
          endpoint: config.embeddingEndpoint,
          apiKey: process.env.RAG_EMBEDDING_API_KEY?.trim() || null,
          model: config.embeddingModel,
          dimensions: config.embeddingDimensions,
          embeddingVersion: config.embeddingVersion,
          allowPrivateContent: config.privateContentEnabled,
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
        });
      },
    },
    KnowledgeOutboxDispatcher,
    KnowledgeIngestionProcessor,
    {
      provide: RAG_LEARNING_MATERIAL_SEARCH,
      inject: [
        RAG_RUNTIME_CONFIG,
        RAG_EMBEDDING_GATEWAY,
        PrismaKnowledgeVectorRepository,
        PrismaCitationRepository,
      ],
      useFactory: (
        config: ReturnType<typeof resolveRagRuntimeConfig>,
        embedding: EmbeddingGateway,
        vectors: PrismaKnowledgeVectorRepository,
        citations: PrismaCitationRepository,
      ) =>
        new RagLearningMaterialSearchService(
          config,
          embedding,
          vectors,
          citations,
        ),
    },
  ],
  exports: [
    RAG_RUNTIME_CONFIG,
    RAG_EMBEDDING_GATEWAY,
    KnowledgeOutboxDispatcher,
    RAG_LEARNING_MATERIAL_SEARCH,
  ],
})
export class KnowledgeModule {}
