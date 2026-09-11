import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../../..');
const prismaSchemaPath = resolve(repositoryRoot, 'server/prisma/schema.prisma');

describe('MCP persistence schema', () => {
  it('declares every authority, lifecycle, and trace model from the data model', () => {
    const schema = readFileSync(prismaSchemaPath, 'utf8');

    for (const model of [
      'McpSubjectMapping',
      'McpClientAuthorization',
      'McpInvocation',
      'McpIdempotencyIntent',
      'McpWriteConfirmation',
      'McpTrace',
      'McpTraceStep',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain('enum CoachConversationOrigin');
    expect(schema).toMatch(
      /origin\s+CoachConversationOrigin\s+@default\(COACH\)/,
    );
  });

  it('represents ownership, uniqueness, expiry, confirmation, and idempotency invariants', () => {
    const schema = readFileSync(prismaSchemaPath, 'utf8');

    expect(schema).toContain('@@unique([issuer, subjectHmac])');
    expect(schema).toContain(
      '@@unique([userId, issuer, clientId, toolName, clientKeyDigest])',
    );
    expect(schema).toMatch(/selectorHmac\s+String\s+@unique/);
    expect(schema).toMatch(/idempotencyIntentId\s+String\s+@unique/);
    expect(schema).toMatch(/traceId\s+String[^\n]*@unique/);
    expect(schema).toMatch(/invocationId\s+String\s+@unique/);
    expect(schema).toContain('@@unique([traceId, sequence])');
    expect(schema).toContain('enum McpWriteConfirmationState');
    for (const state of [
      'PENDING',
      'CONFIRMED',
      'CLAIMED',
      'CONSUMED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'FAILED',
    ]) {
      expect(schema).toMatch(new RegExp(`\\b${state}\\b`));
    }
    for (const expiryField of [
      'retentionExpiresAt',
      'deadlineAt',
      'leaseExpiresAt',
      'expiresAt',
    ]) {
      expect(schema).toMatch(new RegExp(`\\b${expiryField}\\s+DateTime`));
    }
    expect(schema).toMatch(/user\s+User\s+@relation/);
    expect(schema).toMatch(
      /authorization\s+McpClientAuthorization\s+@relation/,
    );
  });
});

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function psql(sql: string): string {
  return execFileSync(
    'psql',
    [databaseUrl!, '-v', 'ON_ERROR_STOP=1', '-X', '-qAt', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

describeDatabase('MCP disposable PostgreSQL invariants', () => {
  it('has all MCP tables and their foreign-key ownership anchors', () => {
    const tableCount = Number(
      psql(String.raw`
        SELECT COUNT(*)
        FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename IN (
            'McpSubjectMapping', 'McpClientAuthorization', 'McpInvocation',
            'McpIdempotencyIntent', 'McpWriteConfirmation', 'McpTrace',
            'McpTraceStep'
          );
      `),
    );
    const foreignKeyCount = Number(
      psql(String.raw`
        SELECT COUNT(*)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'f'
          AND t.relname IN (
            'McpSubjectMapping', 'McpClientAuthorization', 'McpInvocation',
            'McpIdempotencyIntent', 'McpWriteConfirmation', 'McpTrace',
            'McpTraceStep'
          );
      `),
    );

    expect(tableCount).toBe(7);
    expect(foreignKeyCount).toBeGreaterThanOrEqual(10);
  });

  it('installs database checks and unique indexes for state and replay safety', () => {
    const definitions = psql(String.raw`
      SELECT string_agg(indexdef, E'\n' ORDER BY indexname)
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename LIKE 'Mcp%';
    `);
    const checks = psql(String.raw`
      SELECT string_agg(pg_get_constraintdef(c.oid), E'\n')
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.contype = 'c' AND t.relname LIKE 'Mcp%';
    `);

    expect(definitions).toMatch(/issuer.*subjectHmac/is);
    expect(definitions).toMatch(
      /userId.*issuer.*clientId.*toolName.*clientKeyDigest/is,
    );
    expect(definitions).toMatch(/selectorHmac/is);
    expect(definitions).toMatch(/traceId.*sequence/is);
    expect(checks).toMatch(/expiresAt|state|status/is);
  });
});
