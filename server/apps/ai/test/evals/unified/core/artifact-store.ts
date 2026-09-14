import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  linkSync,
  unlinkSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath } from './control-loader';
import { assertSafePayload } from './redaction';

export function createArtifactStore(outputRoot: string, runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId))
    throw Error('INVALID_RUN_ID');
  const parent = realpathSync(outputRoot);
  const root = safePath(parent, runId);
  mkdirSync(root, { mode: 0o700 }); // exclusive; existing runs are never overwritten
  return Object.freeze({
    root,
    write(
      relative: string,
      payload: unknown,
      options: {
        sensitivity?: string;
        format?: 'json' | 'text' | 'jsonl';
      } = {},
    ) {
      // Restricted persistence is deliberately closed until retention-policy integration (US6).
      if (options.sensitivity && options.sensitivity !== 'synthetic_public')
        throw Error('RETENTION_POLICY_REQUIRED');
      assertSafePayload(payload);
      const target = safePath(root, relative);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      safePath(root, relative);
      const temporary = `${target}.${randomUUID()}.tmp`;
      if (options.format === 'text' && typeof payload !== 'string')
        throw Error('TEXT_PAYLOAD_REQUIRED');
      if (options.format === 'jsonl' && !Array.isArray(payload))
        throw Error('JSONL_ROWS_REQUIRED');
      const body =
        options.format === 'text'
          ? (payload as string)
          : options.format === 'jsonl'
            ? (payload as unknown[])
                .map((row) => JSON.stringify(row))
                .join('\n') + '\n'
            : JSON.stringify(payload) + '\n';
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, body);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        // Atomic no-replace publication; rename would overwrite an existing immutable result.
        linkSync(temporary, target);
        const dir = openSync(dirname(target), 'r');
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      } finally {
        unlinkSync(temporary);
      }
      return target;
    },
  });
}
