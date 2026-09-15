import { createHash } from 'node:crypto';
import { safeDiagnostic } from '../core/redaction';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  workerEnvironment,
  assertCleanCwd,
} from '../workers/environment-guard';
import { safePath } from '../core/control-loader';
import registry from '../catalog/jest-tests.v1.json';

export function parseJestResult(value: unknown, expected: readonly string[]) {
  if (!expected.length) throw Error('ZERO_CASES');
  const input = value as {
    testResults?: Array<{
      assertionResults?: Array<{ fullName: string; status: string }>;
    }>;
  };
  if (!Array.isArray(input?.testResults)) throw Error('INVALID_JEST_REPORT');
  const results = new Map<string, string[]>();
  for (const suite of input.testResults) {
    if (!Array.isArray(suite.assertionResults))
      throw Error('INVALID_JEST_REPORT');
    for (const assertion of suite.assertionResults) {
      if (typeof assertion.fullName !== 'string' || !assertion.fullName)
        throw Error('DUPLICATE_JEST_MAPPING');
      const state = {
        passed: 'passed',
        failed: 'failed',
        pending: 'skipped',
        todo: 'skipped',
        disabled: 'skipped',
      }[assertion.status];
      if (!state) throw Error('UNKNOWN_JEST_STATUS');
      results.set(assertion.fullName, [
        ...(results.get(assertion.fullName) ?? []),
        state,
      ]);
    }
  }
  const rows = [...new Set([...expected, ...results.keys()])].flatMap(
    (name) => {
      const states = results.get(name) ?? [];
      const count = Math.max(
        states.length,
        expected.filter((value) => value === name).length,
      );
      return Array.from({ length: count }, (_, index) => ({
        name: count === 1 ? name : `${name} [occurrence ${index + 1}/${count}]`,
        state: states[index] ?? 'not_run',
      }));
    },
  );
  if (new Set(rows.map((row) => row.name)).size !== rows.length)
    throw Error('AMBIGUOUS_JEST_MAPPING');
  return rows;
}

export async function runRegisteredJest(
  id: string,
  serverRoot: string,
  runRoot: string,
  timeoutMs: number,
  signal?: AbortSignal,
  expected?: { sourceHash: string; configHash: string },
) {
  if (signal?.aborted) throw Error('CANCELLED');
  const entry = registry.entries.find((entry) => entry.id === id);
  if (!entry) throw Error('UNREGISTERED_TEST_SUITE');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2147483647
  )
    throw Error('INVALID_TIMEOUT');
  const source = safePath(serverRoot, entry.path);
  const cwd = assertCleanCwd(mkdtempSync(join(runRoot, 'jest-')));
  const reportPath = join(cwd, 'jest-result.json');
  const config = safePath(serverRoot, entry.config);
  const hash = (path: string) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
  if (
    expected &&
    (hash(source) !== expected.sourceHash ||
      hash(config) !== expected.configHash)
  ) {
    rmSync(cwd, { recursive: true, force: true });
    throw Error('TRUSTED_TEST_MISMATCH');
  }
  const args = [
    require.resolve('jest/bin/jest'),
    '--config',
    config,
    '--runTestsByPath',
    source,
    '--runInBand',
    '--json',
    `--outputFile=${reportPath}`,
  ];
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env: workerEnvironment(process.env),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let bytes = 0;
      let failure: Error | undefined;
      const stop = (code: string) => {
        failure ??= Error(code);
        try {
          if (child.pid)
            process.kill(
              process.platform === 'win32' ? child.pid : -child.pid,
              'SIGKILL',
            );
        } catch {
          /* The owned child may already have exited. */
        }
      };
      const cancel = () => stop('CANCELLED');
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
      child.stderr.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > 1024 * 1024) stop('WORKER_OUTPUT_LIMIT');
      });
      child.on('error', () => {
        failure = Error('JEST_START_FAILED');
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (failure) reject(failure);
        else resolve(code ?? 2);
      });
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const results = parseJestResult(report, entry.tests).map((row) => ({
      ...row,
      name: publicTestName(row.name),
    }));
    return {
      suiteId: id,
      exitCode,
      results,
      actualMode: entry.mode,
      missingOrSkipped: results
        .filter((r) => !['passed', 'failed'].includes(r.state))
        .map((r) => r.name),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export function publicTestName(name: string) {
  const safe = safeDiagnostic(name);
  return safe === name
    ? name
    : `redacted-test-${createHash('sha256').update(name).digest('hex')}`;
}
