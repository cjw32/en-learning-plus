import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { contentRefSchema, relativePathSchema } from '../contracts/case.schema';
import { approvalSchema } from '../contracts/evidence.schema';

export function safePath(root: string, path: string): string {
  relativePathSchema.parse(path);
  const canonicalRoot = realpathSync(root);
  let current = canonicalRoot;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (
      existsSync(current) ||
      (() => {
        try {
          lstatSync(current);
          return true;
        } catch {
          return false;
        }
      })()
    ) {
      if (lstatSync(current).isSymbolicLink()) throw Error('SYMLINK_FORBIDDEN');
      const rel = relative(canonicalRoot, realpathSync(current));
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error('PATH_ESCAPE');
    }
  }
  return current;
}

export function readVerifiedJson(root: string, reference: unknown): unknown {
  const ref = contentRefSchema.parse(reference);
  const bytes = readFileSync(safePath(root, ref.path));
  if (createHash('sha256').update(bytes).digest('hex') !== ref.hash)
    throw Error('CONTENT_HASH_MISMATCH');
  return JSON.parse(bytes.toString('utf8'));
}

// The registry must be loaded from the caller's independently trusted control root.
// This checks an existing approval, and never creates authority from candidate data.
export function requireApproval(
  id: unknown,
  registry: readonly unknown[],
  subjectHash: string,
) {
  if (typeof id !== 'string') throw Error('APPROVAL_REFERENCE_REQUIRED');
  const matches = registry
    .map((v) => approvalSchema.parse(v))
    .filter((v) => v.id === id);
  if (
    matches.length !== 1 ||
    matches[0].status !== 'approved' ||
    matches[0].subjectHash !== subjectHash
  )
    throw Error('BASELINE_UNAPPROVED');
  return Object.freeze(matches[0]);
}

export function loadControl(
  root: string,
  manifestRef: unknown,
  schema: { parse(value: unknown): any },
) {
  return Object.freeze(
    schema.parse(readVerifiedJson(realpathSync(root), manifestRef)),
  );
}
