import {
  pronunciationProviderResultSchema,
  pronunciationResultSchema,
  PRONUNCIATION_RESULT_SCHEMA_VERSION,
  type PronunciationLearningUpdate,
  type PronunciationProviderFailure,
  type PronunciationResult,
  type PronunciationResultVersions,
} from '@en/common/pronunciation';
import { PronunciationAlignmentService } from './pronunciation-alignment.service';
import { PronunciationConfidencePolicy } from './pronunciation-confidence.policy';

export class PronunciationResultAssemblyError extends Error {
  constructor(
    readonly code:
      | 'SPEECH_UNRECOGNIZABLE'
      | 'PROVIDER_TIMEOUT'
      | 'PROVIDER_UNAVAILABLE'
      | 'RATE_LIMITED'
      | 'CANCELLED',
    readonly retryable = true,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'PronunciationResultAssemblyError';
  }
}

function providerFailure(failure: PronunciationProviderFailure): never {
  const code = {
    UNRECOGNIZABLE: 'SPEECH_UNRECOGNIZABLE',
    TIMEOUT: 'PROVIDER_TIMEOUT',
    RATE_LIMITED: 'RATE_LIMITED',
    CANCELLED: 'CANCELLED',
    SERVICE_ERROR: 'PROVIDER_UNAVAILABLE',
    INVALID_RESPONSE: 'PROVIDER_UNAVAILABLE',
  }[failure.outcome] as PronunciationResultAssemblyError['code'];
  throw new PronunciationResultAssemblyError(
    code,
    failure.retryable,
    failure.retryAfterSeconds,
  );
}

function deterministicSummary(overall: number): string {
  if (overall >= 85) return '整体发音清晰稳定，请保持当前节奏。';
  if (overall >= 70) return '整体发音基本清晰，仍有少量细节可以改进。';
  return '这次发音还有提升空间，建议放慢速度并分词练习。';
}

function deterministicSuggestions(
  words: PronunciationResult['words'],
): string[] {
  const suggestions: string[] = [];
  if (words.some((word) => word.status === 'omitted')) {
    suggestions.push('先逐词确认，避免漏读目标词。');
  }
  if (words.some((word) => word.status === 'mispronounced')) {
    suggestions.push('重点重复练习标记为误读的词。');
  }
  if (words.some((word) => word.status === 'inserted')) {
    suggestions.push('对照目标文本，减少额外插入的词。');
  }
  if (words.some((word) => word.status === 'uncertain')) {
    suggestions.push('对齐不确定的部分仅供参考，建议重新录制确认。');
  }
  if (suggestions.length === 0) suggestions.push('继续保持清晰、稳定的发音。');
  return suggestions.slice(0, 5);
}

export class PronunciationResultAssembler {
  constructor(
    private readonly alignment = new PronunciationAlignmentService(),
    private readonly confidence = new PronunciationConfidencePolicy(),
  ) {}

  assemble(
    input: Readonly<{
      assessmentId: string;
      referenceText: string;
      targetTokens: readonly string[];
      audioDurationMs: number;
      providerResult: unknown;
      traceId: string;
      versions: PronunciationResultVersions;
      audio: Readonly<{ available: boolean; expiresAt: Date | null }>;
      sourceValid: boolean;
      audioValid: boolean;
      cancelled: boolean;
      timedOut: boolean;
      learningWriteEnabled: boolean;
      learningUpdate?: PronunciationLearningUpdate;
    }>,
  ): PronunciationResult {
    const parsed = pronunciationProviderResultSchema.safeParse(
      input.providerResult,
    );
    if (!parsed.success) {
      throw new PronunciationResultAssemblyError('PROVIDER_UNAVAILABLE');
    }
    if (parsed.data.outcome !== 'SUCCESS') providerFailure(parsed.data);

    const aligned = this.alignment.align({
      targetTokens: input.targetTokens,
      providerWords: parsed.data.words,
      audioDurationMs: input.audioDurationMs,
    });
    const versionsPinned = Object.values(input.versions).every(
      (version) => typeof version === 'string' && version.trim().length > 0,
    );
    const decision = this.confidence.decide({
      confidence: parsed.data.recognitionConfidence,
      overallScore: parsed.data.scores.overall,
      providerOutcome: 'SUCCESS',
      schemaValid: true,
      alignmentReliable: aligned.reliable,
      sourceValid: input.sourceValid,
      audioValid: input.audioValid,
      versionsPinned,
      cancelled: input.cancelled,
      timedOut: input.timedOut,
      learningWriteEnabled: input.learningWriteEnabled,
    });
    if (!decision.resultEligible) {
      throw new PronunciationResultAssemblyError('SPEECH_UNRECOGNIZABLE');
    }

    const words = aligned.words.map(({ seekable: _seekable, ...word }) => word);
    const requestedLearning = input.learningUpdate ?? {
      status: 'NOT_ELIGIBLE' as const,
      changedItems: [],
    };
    const learningUpdate: PronunciationLearningUpdate =
      decision.learningWriteEligible
        ? requestedLearning
        : {
            status: 'NOT_ELIGIBLE',
            changedItems: [],
            message: '本次结果未满足学习进度写入条件。',
          };
    return pronunciationResultSchema.parse({
      schemaVersion: PRONUNCIATION_RESULT_SCHEMA_VERSION,
      assessmentId: input.assessmentId,
      referenceText: input.referenceText,
      recognizedText: parsed.data.recognizedText,
      scores: parsed.data.scores,
      confidence: parsed.data.recognitionConfidence,
      confidenceTier: decision.confidenceTier,
      words,
      summary: deterministicSummary(parsed.data.scores.overall),
      suggestions: deterministicSuggestions(words),
      nextAction: decision.nextAction,
      provider: parsed.data.provider,
      modelVersion: parsed.data.modelVersion,
      learningUpdate,
      audio: {
        available: input.audio.available,
        expiresAt: input.audio.expiresAt?.toISOString() ?? null,
      },
      versions: input.versions,
      traceId: input.traceId,
    });
  }
}
