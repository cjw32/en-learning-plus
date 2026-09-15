import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@libs/shared';
import { MinioService } from '@libs/shared/minio/minio.service';
import { PRONUNCIATION_CONTRACT_VERSIONS } from '@en/common/pronunciation';
import {
  PRONUNCIATION_RUNTIME_CONFIG,
  type PronunciationRuntimeConfig,
} from '../governance/pronunciation-config.schema';
import { PronunciationRedisConnection } from '../governance/pronunciation-redis.module';
import { PronunciationBudgetService } from '../governance/pronunciation-budget.service';
import { RedisPronunciationBudgetStore } from '../governance/redis-pronunciation-budget.store';
import { PronunciationPriceCatalog } from '../governance/pronunciation-price.catalog';
import { PronunciationUsageService } from '../governance/pronunciation-usage.service';
import {
  MinioPronunciationAudioStorage,
  type PronunciationMinioClient,
} from '../storage/minio-pronunciation-audio.storage';
import {
  UnavailablePronunciationAudioStorage,
  type PronunciationAudioStorage,
} from '../storage/pronunciation-audio.storage';
import {
  FfmpegPronunciationAudioInspector,
  NodePronunciationAudioProcessRunner,
} from '../audio/ffmpeg-pronunciation-audio-inspector';
import {
  UnavailablePronunciationAudioInspector,
  type PronunciationAudioInspector,
} from '../audio/pronunciation-audio-inspector';
import { AzurePronunciationAssessmentProvider } from '../provider/azure-pronunciation.provider';
import {
  UnavailablePronunciationAssessmentProvider,
  type PronunciationAssessmentProvider,
} from '../provider/pronunciation-assessment.provider';

@Injectable()
export class PronunciationRuntimeAdapters {
  readonly storage: PronunciationAudioStorage;
  readonly inspector: PronunciationAudioInspector;
  readonly provider: PronunciationAssessmentProvider;
  readonly currency: string;

  constructor(
    private readonly environment: ConfigService,
    @Inject(PRONUNCIATION_RUNTIME_CONFIG)
    readonly config: PronunciationRuntimeConfig,
    minio: MinioService,
    prisma: PrismaService,
    private readonly redis: PronunciationRedisConnection,
  ) {
    const value = (name: string) =>
      environment.get<string>(name)?.trim() || null;
    const required = (name: string) => {
      const text = value(name);
      if (!text)
        throw new Error(`Pronunciation configuration requires ${name}`);
      return text;
    };
    const integer = (name: string, minimum: number) => {
      const number = Number(required(name));
      if (!Number.isSafeInteger(number) || number < minimum)
        throw new Error(`Invalid pronunciation configuration: ${name}`);
      return number;
    };
    this.currency = value('PRONUNCIATION_CURRENCY') ?? '';
    if (config.storageApproved) required('PRONUNCIATION_TRACE_PEPPER');
    this.storage = config.storageApproved
      ? new MinioPronunciationAudioStorage(
          minio.getClient() as unknown as PronunciationMinioClient,
          {
            approved: true,
            bucket: required('PRONUNCIATION_AUDIO_BUCKET'),
            prefix: 'pronunciation/',
            retentionHours: 24,
          },
        )
      : new UnavailablePronunciationAudioStorage();
    this.inspector = config.audioRuntimeApproved
      ? new FfmpegPronunciationAudioInspector(
          {
            approved: true,
            ffmpegPath: required('PRONUNCIATION_FFMPEG_PATH'),
            ffprobePath: required('PRONUNCIATION_FFPROBE_PATH'),
            timeoutMs: 10000,
            maxOutputBytes: 3 * 1024 * 1024,
            maxMemoryBytes: 128 * 1024 * 1024,
            maxConcurrent: 2,
          },
          new NodePronunciationAudioProcessRunner(),
        )
      : new UnavailablePronunciationAudioInspector();
    if (!config.providerEnabled) {
      this.provider = new UnavailablePronunciationAssessmentProvider();
      return;
    }
    required('PRONUNCIATION_TRACE_PEPPER');
    const store = new RedisPronunciationBudgetStore({
      eval: async (...args) => {
        await redis.assertReady();
        return redis.getAtomicClient().eval(...args);
      },
    });
    const budgets = new PronunciationBudgetService(store, {
      ...config,
      currency: this.currency,
      budgetVersion: config.budgetPolicyVersion,
    });
    const tier = value('AZURE_SPEECH_TIER') ?? 'S0';
    if (!['F0', 'S0'].includes(tier))
      throw new Error('Invalid AZURE_SPEECH_TIER');
    if (
      tier === 'F0' &&
      integer('PRONUNCIATION_PRICE_MICROS_PER_SECOND', 0) !== 0
    ) {
      throw new Error('F0 requires zero pronunciation price');
    }
    const seconds = (key: string, fallback: number) =>
      value(key) ? integer(key, 1) : fallback;
    const monthSeconds = seconds('PRONUNCIATION_MONTHLY_AUDIO_SECONDS', 14400);
    if (tier === 'F0' && monthSeconds > 18000)
      throw new Error('F0 audio quota exceeds five hours');
    const usage = new PronunciationUsageService(
      {
        eval: async (...args) => {
          await redis.assertReady();
          return redis.getAtomicClient().eval(...args);
        },
      },
      `azure:${config.providerRegion}`,
      {
        subjectDaySeconds: seconds(
          'PRONUNCIATION_SUBJECT_DAILY_AUDIO_SECONDS',
          300,
        ),
        daySeconds: seconds('PRONUNCIATION_DAILY_AUDIO_SECONDS', 1800),
        monthSeconds,
      },
    );
    const prices = new PronunciationPriceCatalog([
      {
        provider: 'azure',
        modelVersion: config.providerModelVersion!,
        region: config.providerRegion!,
        capability: 'BASE',
        currency: this.currency,
        priceVersion: config.priceVersion!,
        approved: true,
        microsPerSecond: integer('PRONUNCIATION_PRICE_MICROS_PER_SECOND', 0),
        minimumBillableMs: integer('PRONUNCIATION_MINIMUM_BILLABLE_MS', 0),
        validFrom: required('PRONUNCIATION_PRICE_VALID_FROM'),
        validUntil: required('PRONUNCIATION_PRICE_VALID_UNTIL'),
      },
    ]);
    this.provider = new AzurePronunciationAssessmentProvider(
      {
        enabled: true,
        providerApproved: config.providerApproved,
        endpoint: value('AZURE_SPEECH_ENDPOINT'),
        resourceName: value('AZURE_SPEECH_RESOURCE_NAME'),
        subscriptionKey: required('AZURE_SPEECH_KEY'),
        region: required('AZURE_SPEECH_REGION'),
        approvedRegion: config.providerRegion,
        privacyEvidenceVersion: config.privacyEvidenceVersion,
        modelVersion: config.providerModelVersion,
        modelIdentityMode: (value('PRONUNCIATION_MODEL_IDENTITY_MODE') ??
          'VENDOR_ATTESTED') as 'AZURE_MANAGED' | 'VENDOR_ATTESTED',
        modelIdentityEvidenceVersion: value(
          'PRONUNCIATION_MODEL_IDENTITY_EVIDENCE_VERSION',
        ),
        modelIdentityVendorAttested:
          value('PRONUNCIATION_MODEL_IDENTITY_VENDOR_ATTESTED') === 'true',
        modelIdentityImmutable:
          value('PRONUNCIATION_MODEL_IDENTITY_IMMUTABLE') === 'true',
        modelIdentityQueryable:
          value('PRONUNCIATION_MODEL_IDENTITY_QUERYABLE') === 'true',
        adapterVersion: PRONUNCIATION_CONTRACT_VERSIONS.providerAdapter,
        apiContractVersion: PRONUNCIATION_CONTRACT_VERSIONS.providerApi,
        capabilityVersion: PRONUNCIATION_CONTRACT_VERSIONS.providerCapability,
        priceVersion: config.priceVersion,
        budgetPolicyVersion: config.budgetPolicyVersion,
        currency: this.currency,
        prosodyApproved: false,
      },
      {
        reserve: async (input) => {
          const owner = await prisma.pronunciationAssessment.findUnique({
            where: { id: input.assessmentId },
            select: {
              userId: true,
              status: true,
              cancelRequestedAt: true,
              hiddenAt: true,
              deadlineAt: true,
            },
          });
          if (
            !owner ||
            owner.status !== 'PROCESSING' ||
            owner.cancelRequestedAt ||
            owner.hiddenAt ||
            owner.deadlineAt <= new Date()
          )
            throw new Error('PRONUNCIATION_CALL_NOT_ALLOWED');
          const at = new Date();
          const price = prices.resolve({ ...input, at });
          const estimatedCostMicros = prices.estimateMicros(
            price,
            input.durationMs,
          );
          const reservation = await budgets.reserve({
            reservationId: `pronunciation-${randomUUID()}`,
            subjectId: owner.userId,
            estimatedCostMicros,
            currency: input.currency,
            budgetVersion: input.budgetPolicyVersion,
            at,
          });
          try {
            await usage.reserve(
              reservation.reservationId,
              owner.userId,
              input.durationMs,
              at,
            );
          } catch (error) {
            await budgets.release(reservation.reservationId);
            throw error;
          }
          return {
            reservationId: reservation.reservationId,
            estimatedCostMicros,
            currency: input.currency,
            priceVersion: input.priceVersion,
            budgetPolicyVersion: input.budgetPolicyVersion,
          };
        },
        settle: async (id, cost) => {
          await budgets.settle(id, cost);
          await usage.spend(id);
        },
        release: async (id) => {
          await budgets.release(id);
          await usage.release(id);
        },
        complete: (id) => usage.complete(id),
      },
    );
  }

  async capabilities() {
    const configured =
      this.config.captureEnabled &&
      this.config.uploadEnabled &&
      this.config.providerEnabled &&
      this.config.resultDisplayEnabled;
    let available = false;
    if (configured) {
      try {
        await Promise.all([
          this.storage.assertPrivateLifecycleReady(),
          this.inspector.assertRuntimeReady(),
          this.redis.assertReady(),
        ]);
        available = true;
      } catch {
        /* Only expose service availability, never connection details. */
      }
    }
    return {
      available,
      reason: available
        ? null
        : configured
          ? 'SERVICE_UNAVAILABLE'
          : 'FEATURE_DISABLED',
      locales: ['en-US', 'en-GB'],
      sources: ['MANUAL', 'WORD_BOOK', 'COACH_EXERCISE'],
      learningWrite: available && this.config.learningWriteEnabled,
      coachSummary: available && this.config.coachSummaryEnabled,
      maxDurationMs: 30000,
      maxBytes: 8 * 1024 * 1024,
      maxWords: 30,
      maxCharacters: 200,
    };
  }
}
