import {
  KnowledgeAccessScope,
  KnowledgeDomainError,
  KnowledgeVisibility,
} from '../domain/knowledge.types';

export const KNOWLEDGE_INSTRUCTION_SIGNALS = [
  'IGNORE_INSTRUCTIONS',
  'REVEAL_PROMPT',
  'IDENTITY_OVERRIDE',
  'TOOL_OVERRIDE',
] as const;
export type KnowledgeInstructionSignal =
  (typeof KNOWLEDGE_INSTRUCTION_SIGNALS)[number];

type ValidationInput = Readonly<{
  content: string;
  visibility: KnowledgeVisibility;
  accessScope: KnowledgeAccessScope;
  ownerUserId: string | null;
}>;

type ValidationResult = Readonly<{
  content: string;
  instructionSignals: readonly KnowledgeInstructionSignal[];
}>;

const piiPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d[\s().-]?){8,15}\b/,
  /\b(?:bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i,
  /\b(?:api[_-]?key|password|secret)\s*[:=]\s*\S+/i,
] as const;

const instructionPatterns: ReadonlyArray<
  readonly [KnowledgeInstructionSignal, RegExp]
> = [
  [
    'IGNORE_INSTRUCTIONS',
    /\bignore\s+(?:all\s+)?(?:previous|system)?\s*instructions?\b/i,
  ],
  [
    'REVEAL_PROMPT',
    /\b(?:reveal|show|print|repeat)\s+(?:the\s+)?(?:system\s+)?prompt\b/i,
  ],
  ['IDENTITY_OVERRIDE', /\b(?:you are now|act as|override identity)\b/i],
  ['TOOL_OVERRIDE', /\b(?:call|invoke|run)\s+(?:the\s+)?(?:tool|function)\b/i],
];

function reject(
  code: ConstructorParameters<typeof KnowledgeDomainError>[0],
): never {
  throw new KnowledgeDomainError(code);
}

export class KnowledgeContentValidator {
  constructor(
    private readonly limits: Readonly<{
      minimumMeaningfulLength: number;
      maximumLength: number;
    }>,
  ) {
    if (
      !Number.isInteger(limits.minimumMeaningfulLength) ||
      !Number.isInteger(limits.maximumLength) ||
      limits.minimumMeaningfulLength < 1 ||
      limits.maximumLength < limits.minimumMeaningfulLength
    ) {
      throw new Error('CONTENT_VALIDATION_LIMITS_INVALID');
    }
  }

  validate(input: ValidationInput): ValidationResult {
    const content = input.content
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!content) {
      reject('CONTENT_EMPTY');
    }
    if (content.length < this.limits.minimumMeaningfulLength) {
      reject('CONTENT_TOO_SHORT');
    }
    if (content.length > this.limits.maximumLength) {
      reject('CONTENT_TOO_LONG');
    }

    if (
      /^#{1,6}\s+[^.!?。！？]+$/u.test(content) ||
      /^(?:https?:\/\/|www\.)\S+$/iu.test(content)
    ) {
      reject('CONTENT_STRUCTURE_INVALID');
    }
    if (
      /\{\{[^{}]+\}\}|\[\[(?:todo|replace|template)[^\]]*\]\]/iu.test(content)
    ) {
      reject('CONTENT_TEMPLATE_REJECTED');
    }
    if (piiPatterns.some((pattern) => pattern.test(content))) {
      reject('CONTENT_PII_REJECTED');
    }

    const sentences = content
      .toLowerCase()
      .split(/[.!?。！？]+/u)
      .map((sentence) => sentence.trim())
      .filter(
        (sentence) => sentence.length >= this.limits.minimumMeaningfulLength,
      );
    if (sentences.length >= 3 && new Set(sentences).size === 1) {
      reject('CONTENT_STRUCTURE_INVALID');
    }

    if (input.accessScope === 'PRIVATE_OWNER') {
      if (input.visibility !== 'private' || !input.ownerUserId?.trim()) {
        reject('PRIVATE_OWNER_REQUIRED');
      }
    } else if (input.visibility !== 'public' || input.ownerUserId !== null) {
      reject('KNOWLEDGE_INVALID_ACCESS_SCOPE');
    }

    const instructionSignals = instructionPatterns
      .filter(([, pattern]) => pattern.test(content))
      .map(([signal]) => signal);

    return Object.freeze({
      content,
      instructionSignals: Object.freeze(instructionSignals),
    });
  }
}
