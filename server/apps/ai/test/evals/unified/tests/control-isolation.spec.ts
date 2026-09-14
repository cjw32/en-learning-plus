import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
  statSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subject } from './test-support';

const control = subject('core/control-loader');
const guard = subject('workers/environment-guard');
const snapshots = subject('core/version-snapshot');
const artifacts = subject('core/artifact-store');
const redaction = subject('core/redaction');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'unified-control-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('T006 trusted control', () => {
  test('reads only a matching manifest from trusted root', () => {
    writeFileSync(join(root, 'policy.json'), '{"version":1}');
    const hash = require('node:crypto')
      .createHash('sha256')
      .update('{"version":1}')
      .digest('hex');
    expect(
      control.readVerifiedJson?.(root, { path: 'policy.json', hash }),
    ).toEqual({ version: 1 });
    expect(() =>
      control.readVerifiedJson?.(root, {
        path: 'policy.json',
        hash: '0'.repeat(64),
      }),
    ).toThrow();
  });
  test('rejects symlink and traversal before reading', () => {
    symlinkSync('/etc', join(root, 'escape'));
    expect(() => control.safePath?.(root, '../secret')).toThrow();
    expect(() => control.safePath?.(root, 'escape/hosts')).toThrow();
  });
  test('candidate approved=true is not a trusted approval', () => {
    expect(() =>
      control.requireApproval?.(
        { id: 'approval', approved: true },
        [],
        'candidate-hash',
      ),
    ).toThrow();
    expect(
      control.requireApproval?.(
        'a1',
        [
          {
            id: 'a1',
            subjectHash: 'a'.repeat(64),
            approvedBy: 'maintainer',
            approvedAt: '2026-09-14T00:00:00Z',
            status: 'approved',
            reason: 'reviewed',
          },
        ],
        'a'.repeat(64),
      ),
    ).toMatchObject({ id: 'a1' });
  });
});

describe('T006 environment isolation', () => {
  test('constructs environment without inherited secrets, preload flags or dotenv', () => {
    expect(
      guard.workerEnvironment?.({
        PATH: '/usr/bin',
        HOME: '/private/user',
        NODE_OPTIONS: '--require evil',
        DATABASE_URL: 'production',
        API_KEY: 'secret',
      }),
    ).toEqual({ PATH: '/usr/bin', NODE_ENV: 'test' });
    writeFileSync(join(root, '.env'), 'sensitive');
    expect(() => guard.assertCleanCwd?.(root)).toThrow();
  });
  test('resource identity must match every approved field before lease creation', async () => {
    const approved = {
      host: '127.0.0.1',
      database: 'isolated',
      role: 'eval_readwrite',
      fingerprint: 'fp',
      namespace: 'run-only',
      productionAccess: false,
    };
    expect(
      await guard.verifyResource?.(approved, async () => approved),
    ).toEqual(approved);
    await expect(
      guard.verifyResource?.(approved, async () => ({
        ...approved,
        role: 'postgres',
      })),
    ).rejects.toThrow();
    await expect(
      guard.verifyResource?.(approved, async () => ({
        ...approved,
        productionAccess: true,
      })),
    ).rejects.toThrow();
  });
});

describe('T012 snapshot identity', () => {
  test('hash changes when included input changes; excludes credentials', () => {
    writeFileSync(join(root, 'source.ts'), 'export const n=1');
    const one = snapshots.hashFiles?.(root, ['source.ts']);
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(root, 'source.ts'), 'export const n=2');
    expect(snapshots.hashFiles?.(root, ['source.ts'])).not.toBe(one);
    writeFileSync(join(root, '.env'), 'secret');
    expect(() => snapshots.hashFiles?.(root, ['.env'])).toThrow();
  });
});

describe('T015 private artifacts', () => {
  test('creates private run and atomically writes without overwriting', () => {
    const store = artifacts.createArtifactStore?.(root, 'run-1');
    expect(store?.root).toBe(join(realpathSync(root), 'run-1'));
    store?.write('result.json', { status: 'INCOMPLETE' });
    expect(
      JSON.parse(readFileSync(join(root, 'run-1/result.json'), 'utf8')),
    ).toEqual({ status: 'INCOMPLETE' });
    expect(statSync(join(root, 'run-1')).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, 'run-1/result.json')).mode & 0o777).toBe(0o600);
    expect(() => store?.write('result.json', {})).toThrow();
    expect(() => store?.write('../escape.json', {})).toThrow();
    expect(() => artifacts.createArtifactStore?.(root, 'run-1')).toThrow();
  });
  test('rejects symlink targets and restricted content without approved policy', () => {
    const store = artifacts.createArtifactStore?.(root, 'run-2');
    if (store) symlinkSync('/tmp', join(store.root, 'outside'));
    expect(() => store?.write('outside/file.json', {})).toThrow();
    expect(() =>
      store?.write('private.json', {}, { sensitivity: 'audio' }),
    ).toThrow();
  });
  test('redacts stderr and rejects secret-like payloads before persistence', () => {
    const raw =
      'postgresql://user:pass@host/db sk-abcdefghijk user@example.com';
    expect(redaction.safeDiagnostic?.(raw)).not.toContain('pass@host');
    expect(redaction.safeDiagnostic?.(raw)).toBe('[REDACTED_DIAGNOSTIC]');
    expect(() =>
      redaction.assertSafePayload?.({ apiKey: 'plain-value' }),
    ).toThrow();
    expect(() => redaction.assertSafePayload?.({ message: raw })).toThrow();
  });
});

describe('review: complete candidate input inventory', () => {
  const exec = require('node:child_process').execFileSync;
  function repository() {
    exec('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    writeFileSync(join(root, 'source.ts'), 'export const n = 1;\n');
    exec('git', ['-C', root, 'add', 'source.ts', 'pnpm-lock.yaml']);
    exec('git', [
      '-C',
      root,
      '-c',
      'user.name=Regression Test',
      '-c',
      'user.email=regression@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'test fixture',
    ]);
  }
  test('includes JSONL inputs while omitting credentials', () => {
    repository();
    writeFileSync(join(root, 'cases.jsonl'), '{"id":"synthetic"}\n');
    writeFileSync(join(root, '.env'), 'not-a-real-secret');
    const snapshot = snapshots.snapshotCandidate?.(root);
    expect(snapshot?.inputFiles).toContain('cases.jsonl');
    expect(snapshot?.inputFiles).not.toContain('.env');
  });
  test.each(['add', 'delete', 'change'])(
    'detects %s after the frozen inventory',
    (operation) => {
      repository();
      const snapshot = snapshots.snapshotCandidate?.(root);
      if (operation === 'add')
        writeFileSync(join(root, 'new-case.jsonl'), '{}\n');
      if (operation === 'delete') rmSync(join(root, 'source.ts'));
      if (operation === 'change')
        writeFileSync(join(root, 'source.ts'), 'export const n = 2;\n');
      expect(() =>
        snapshots.assertCandidateUnchanged?.(root, snapshot),
      ).toThrow('CANDIDATE_CHANGED_DURING_RUN');
    },
  );
});
