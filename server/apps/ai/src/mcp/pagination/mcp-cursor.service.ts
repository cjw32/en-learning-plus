import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type McpCursorBinding = Readonly<{
  principalKey: string;
  resource: string;
  filterHash: string;
  contentVersion: string;
}>;

export type McpCursorPosition = Readonly<{
  sortValue: string;
  tieBreaker: string;
}>;

type CursorPayload = Readonly<{
  v: 1;
  b: string;
  s: string;
  t: string;
  i: number;
  e: number;
}>;

export class McpCursorError extends Error {
  readonly code = 'CURSOR_INVALID' as const;

  constructor() {
    super('The pagination cursor is invalid or expired.');
    this.name = 'McpCursorError';
  }
}

function invalid(): never {
  throw new McpCursorError();
}

function validateText(value: string, maximum: number): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    invalid();
  }
}

function bindingHash(binding: McpCursorBinding): string {
  validateText(binding.principalKey, 256);
  validateText(binding.resource, 512);
  validateText(binding.filterHash, 256);
  validateText(binding.contentVersion, 256);
  return createHash('sha256')
    .update(
      [
        binding.principalKey,
        binding.resource,
        binding.filterHash,
        binding.contentVersion,
      ].join('\0'),
    )
    .digest('base64url');
}

function isPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<CursorPayload>;
  return (
    Object.keys(candidate).length === 6 &&
    candidate.v === 1 &&
    typeof candidate.b === 'string' &&
    /^[A-Za-z0-9_-]{43}$/u.test(candidate.b) &&
    typeof candidate.s === 'string' &&
    candidate.s.length >= 1 &&
    candidate.s.length <= 256 &&
    typeof candidate.t === 'string' &&
    candidate.t.length >= 1 &&
    candidate.t.length <= 256 &&
    typeof candidate.i === 'number' &&
    Number.isSafeInteger(candidate.i) &&
    typeof candidate.e === 'number' &&
    Number.isSafeInteger(candidate.e) &&
    candidate.e > candidate.i
  );
}

export class McpCursorService {
  private readonly key: Buffer;

  constructor(
    private readonly options: Readonly<{
      hmacKey: string;
      ttlMs: number;
      now: () => Date;
    }>,
  ) {
    this.key = Buffer.from(options.hmacKey, 'utf8');
    if (
      this.key.byteLength < 32 ||
      !Number.isSafeInteger(options.ttlMs) ||
      options.ttlMs < 1 ||
      options.ttlMs > 60 * 60 * 1_000
    ) {
      throw new Error('Invalid MCP cursor service configuration');
    }
  }

  issue(binding: McpCursorBinding, position: McpCursorPosition): string {
    validateText(position.sortValue, 256);
    validateText(position.tieBreaker, 256);
    const issuedAt = this.options.now().getTime();
    if (!Number.isSafeInteger(issuedAt)) invalid();
    const payload: CursorPayload = Object.freeze({
      v: 1,
      b: bindingHash(binding),
      s: position.sortValue,
      t: position.tieBreaker,
      i: issuedAt,
      e: issuedAt + this.options.ttlMs,
    });
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(cursor: string, binding: McpCursorBinding): McpCursorPosition {
    if (
      typeof cursor !== 'string' ||
      cursor.length < 24 ||
      cursor.length > 512 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(cursor)
    ) {
      invalid();
    }
    const [encoded, suppliedSignature] = cursor.split('.');
    if (!encoded || !suppliedSignature) invalid();
    const expectedSignature = this.sign(encoded);
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (
      supplied.byteLength !== expected.byteLength ||
      !timingSafeEqual(supplied, expected)
    ) {
      invalid();
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      invalid();
    }
    if (!isPayload(decoded)) invalid();
    if (
      decoded.b !== bindingHash(binding) ||
      this.options.now().getTime() >= decoded.e
    ) {
      invalid();
    }
    validateText(decoded.s, 256);
    validateText(decoded.t, 256);
    return Object.freeze({
      sortValue: decoded.s,
      tieBreaker: decoded.t,
    });
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
