import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { safePath } from './control-loader';

const sensitiveFile =
  /(?:^|\/)(?:\.env(?:\..*)?|.*(?:secret|credentials|private[-_]?key).*|.*\.(?:pem|p12|key))$/i;
export function hashFiles(
  root: string,
  files: readonly string[],
  allowDeleted = false,
): string {
  const digest = createHash('sha256');
  for (const name of [...new Set(files)].sort()) {
    if (sensitiveFile.test(name)) throw Error('SENSITIVE_SNAPSHOT_INPUT');
    const path = safePath(root, name);
    if (allowDeleted && !existsSync(path)) {
      digest.update(JSON.stringify([name, 'deleted'])).update('\0');
      continue;
    }
    const data = readFileSync(path);
    digest
      .update(JSON.stringify([name, data.length]))
      .update('\0')
      .update(data)
      .update('\0');
  }
  return digest.digest('hex');
}

function gitRead(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      root,
      ...args,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        TMPDIR: '/tmp',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

export function snapshotCode(
  root: string,
  inputFiles: readonly string[],
  untrackedFiles: readonly string[] = [],
) {
  const git = (...args: string[]) => gitRead(root, ...args);
  const files = [...new Set(inputFiles)].sort();
  if (!files.length || untrackedFiles.some((f) => !files.includes(f)))
    throw Error('SNAPSHOT_INPUTS_REQUIRED');
  const tree = hashFiles(root, files, true);
  const status = git(
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    ...files,
  );
  const diff = git(
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    'HEAD',
    '--',
    ...files,
  );
  return Object.freeze({
    commit: git('rev-parse', 'HEAD').trim(),
    branchLabel: git('branch', '--show-current').trim() || 'detached',
    dirty: status.length > 0,
    trackedDiffHash: createHash('sha256').update(diff).digest('hex'),
    includedUntrackedSourceHash: hashFiles(root, untrackedFiles),
    lockfileHash: hashFiles(root, ['pnpm-lock.yaml']),
    candidateTreeHash: tree,
    inputFiles: files,
  });
}

export function assertUnchanged(
  root: string,
  snapshot: { inputFiles: readonly string[]; candidateTreeHash: string },
) {
  if (hashFiles(root, snapshot.inputFiles) !== snapshot.candidateTreeHash)
    throw Error('CANDIDATE_CHANGED_DURING_RUN');
}

// Freeze the complete Git-visible input inventory, including JSONL, binary
// fixtures and tracked deletions. Ignore rules and sensitive-file exclusions
// match the same policy at admission and at final reconciliation.
function candidateInputs(root: string) {
  const files = [
    ...new Set(
      gitRead(
        root,
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      )
        .split('\0')
        .filter((p) => p && !sensitiveFile.test(p)),
    ),
  ].sort();
  const untracked = gitRead(
    root,
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
  )
    .split('\0')
    .filter((p) => files.includes(p));
  return { files, untracked };
}
export function snapshotCandidate(root: string) {
  const { files, untracked } = candidateInputs(root);
  return snapshotCode(root, files, untracked);
}
export function assertCandidateUnchanged(
  root: string,
  snapshot: ReturnType<typeof snapshotCode>,
) {
  try {
    const { files } = candidateInputs(root);
    if (
      JSON.stringify(files) !== JSON.stringify(snapshot.inputFiles) ||
      hashFiles(root, files, true) !== snapshot.candidateTreeHash ||
      gitRead(root, 'rev-parse', 'HEAD').trim() !== snapshot.commit
    )
      throw Error('changed');
  } catch {
    throw Error('CANDIDATE_CHANGED_DURING_RUN');
  }
}
