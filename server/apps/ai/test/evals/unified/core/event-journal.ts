import { createHash } from 'node:crypto';
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  fsyncSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';
import { assertSafePayload } from './redaction';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type JournalEvent = {
  runId: string;
  sequence: number;
  type: string;
  previousHash: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  eventHash: string;
};

export function createJournal(
  root: string,
  runId: string,
  manifest: Record<string, unknown>,
) {
  if (!/^[\w-]+$/.test(runId)) throw Error('INVALID_RUN_ID');
  assertSafePayload(manifest);
  const frozenManifest = { ...manifest, runId };
  const file = join(root, 'manifest.json');
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(frozenManifest)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const eventPath = join(root, 'events.jsonl');
  const eventFd = openSync(eventPath, 'wx', 0o600);
  try {
    fsyncSync(eventFd);
  } finally {
    closeSync(eventFd);
  }
  const dirFd = openSync(root, 'r');
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  let sequence = 0;
  let previousHash = digest(frozenManifest);
  let failed = false;
  const reserved = new Set<string>();
  const dispatched = new Set<string>();
  return {
    get sequence() {
      return sequence;
    },
    append(type: string, payload: Record<string, unknown>): JournalEvent {
      if (failed) throw Error('JOURNAL_UNAVAILABLE');
      assertSafePayload(payload);
      if (!/^[A-Z][A-Z0-9_]+$/.test(type)) throw Error('INVALID_EVENT_TYPE');
      if (
        type === 'DISPATCHED' &&
        (!reserved.has(String(payload.callId)) ||
          dispatched.has(String(payload.callId)))
      )
        throw Error('DISPATCH_WITHOUT_RESERVATION');
      const data = {
        runId,
        sequence: sequence + 1,
        type,
        previousHash,
        payload: structuredClone(payload),
        payloadHash: digest(payload),
      };
      const event = { ...data, eventHash: digest(data) };
      try {
        const fd = openSync(
          eventPath,
          constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
        );
        try {
          writeFileSync(fd, `${JSON.stringify(event)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } catch {
        failed = true;
        throw Error('JOURNAL_WRITE_FAILED');
      }
      sequence = event.sequence;
      previousHash = event.eventHash;
      if (type === 'RESERVED') reserved.add(String(payload.callId));
      if (type === 'DISPATCHED') dispatched.add(String(payload.callId));
      return structuredClone(event);
    },
  };
}

export function readJournal(root: string, runId: string) {
  const events: JournalEvent[] = [];
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    );
    if (manifest.runId !== runId) throw Error('RUN_MISMATCH');
    let previousHash = digest(manifest);
    const source = readFileSync(join(root, 'events.jsonl'), 'utf8');
    const lines = source.split('\n');
    const truncated = lines.pop() !== '';
    const reserved = new Set<string>();
    const dispatched = new Set<string>();
    for (const line of lines) {
      const event: JournalEvent = JSON.parse(line);
      const { eventHash, ...body } = event;
      if (
        Object.keys(event).sort().join() !==
          [
            'runId',
            'sequence',
            'type',
            'previousHash',
            'payload',
            'payloadHash',
            'eventHash',
          ]
            .sort()
            .join() ||
        event.runId !== runId ||
        event.sequence !== events.length + 1 ||
        event.previousHash !== previousHash ||
        event.payloadHash !== digest(event.payload) ||
        eventHash !== digest(body)
      )
        throw Error('JOURNAL_INVALID');
      if (
        event.type === 'DISPATCHED' &&
        (!reserved.has(String(event.payload.callId)) ||
          dispatched.has(String(event.payload.callId)))
      )
        throw Error('DISPATCH_WITHOUT_RESERVATION');
      if (event.type === 'RESERVED') reserved.add(String(event.payload.callId));
      if (event.type === 'DISPATCHED')
        dispatched.add(String(event.payload.callId));
      events.push(event);
      previousHash = eventHash;
    }
    return {
      manifest,
      events,
      complete: !truncated,
      reason: truncated ? 'JOURNAL_TRUNCATED' : null,
    };
  } catch {
    return { events, complete: false, reason: 'JOURNAL_INVALID' };
  }
}
