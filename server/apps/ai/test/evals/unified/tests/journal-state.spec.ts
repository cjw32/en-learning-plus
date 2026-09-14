import {
  mkdtempSync,
  rmSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subject, item, result, hash } from './test-support';

const journal = subject('core/event-journal');
const states = subject('core/run-state');
const gates = subject('core/gate');
const counts = subject('core/counts');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'unified-journal-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('T007 durable events and frozen run state', () => {
  test('manifest precedes events, reservations precede dispatch, chain verifies', () => {
    const log = journal.createJournal?.(root, 'run-1', {
      schemaVersion: 'manifest.v1',
      items: [item],
    });
    expect(log?.append('RESERVED', { callId: 'call-1' })).toMatchObject({
      sequence: 1,
      runId: 'run-1',
    });
    expect(log?.append('DISPATCHED', { callId: 'call-1' })).toMatchObject({
      sequence: 2,
    });
    expect(journal.readJournal?.(root, 'run-1')).toMatchObject({
      complete: true,
      events: expect.any(Array),
    });
    expect(
      JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).items,
    ).toEqual([item]);
    appendFileSync(join(root, 'events.jsonl'), '{truncated');
    expect(journal.readJournal?.(root, 'run-1')).toMatchObject({
      complete: false,
      reason: 'JOURNAL_TRUNCATED',
    });
  });
  test('rejects missing reservation, duplicate manifest and tampered chain', () => {
    const log = journal.createJournal?.(root, 'run-1', { items: [] });
    expect(() => log?.append('DISPATCHED', { callId: 'unreserved' })).toThrow();
    expect(() => journal.createJournal?.(root, 'run-1', {})).toThrow();
    log?.append('RESERVED', { callId: 'call-1' });
    const file = join(root, 'events.jsonl');
    if (log)
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('call-1', 'call-2'),
      );
    expect(journal.readJournal?.(root, 'run-1')).toMatchObject({
      complete: false,
    });
  });
  test('failed persistence does not advance memory state', () => {
    const log = journal.createJournal?.(root, 'run-1', { items: [] });
    rmSync(root, { recursive: true });
    expect(() => log?.append('RESERVED', { callId: 'call-1' })).toThrow();
    expect(log?.sequence).toBe(0);
  });
  test('one terminal per planned item, unknown item rejected, missing item retained', () => {
    const state = states.createRunState?.([
      item,
      { ...item, itemId: 'item-2' },
    ]);
    state?.finish(result);
    expect(() =>
      state?.finish({
        ...result,
        terminalState: 'failed',
        reasonCodes: ['CONTRACT_BREAK'],
      }),
    ).toThrow();
    expect(() => state?.finish({ ...result, itemId: 'unknown' })).toThrow();
    expect(state?.finalize()).toEqual([
      result,
      expect.objectContaining({ itemId: 'item-2', terminalState: 'not_run' }),
    ]);
  });
});

describe('T016 counts and four-state precedence', () => {
  test('counts reconcile terminal buckets; attempts do not add planned items', () => {
    const items = [
      result,
      {
        ...result,
        itemId: 'two',
        terminalState: 'error',
        reasonCodes: ['WORKER_CRASH'],
        allAttempts: ['b', 'c'],
      },
    ];
    expect(counts.countResults?.(items)).toMatchObject({
      planned: 2,
      completed: 1,
      passed: 1,
      error: 1,
      attempts: 3,
      uniqueCases: 1,
    });
    expect(() => counts.countResults?.([result, result])).toThrow();
  });
  test.each([
    [[], 'INCOMPLETE', 2],
    [[result], 'PASS', 0],
    [
      [
        {
          ...result,
          terminalState: 'review',
          reasonCodes: ['REVIEW_REQUIRED'],
        },
      ],
      'REVIEW',
      3,
    ],
    [
      [{ ...result, terminalState: 'error', reasonCodes: ['JUDGE_FAILED'] }],
      'INCOMPLETE',
      2,
    ],
    [
      [
        { ...result, terminalState: 'failed', reasonCodes: ['CONTRACT_BREAK'] },
        {
          ...result,
          itemId: 'two',
          terminalState: 'error',
          reasonCodes: ['JUDGE_FAILED'],
        },
      ],
      'FAIL',
      1,
    ],
  ])('retains gate priority for %#', (items, status, exitCode) => {
    expect(
      gates.decideGate?.(items, {
        scopeClaim: 'quick/check',
        policyHash: hash,
      }),
    ).toMatchObject({ status, exitCode });
  });
  test('FAIL preserves incomplete fact and optional safety failure', () => {
    const results = [
      {
        ...result,
        required: false,
        terminalState: 'failed',
        reasonCodes: ['CROSS_USER_LEAK'],
      },
    ];
    expect(
      gates.decideGate?.(results, {
        scopeClaim: 'check',
        policyHash: hash,
        missingRequirements: ['missing'],
      }),
    ).toMatchObject({
      status: 'FAIL',
      executionCompleteness: 'incomplete',
      missingRequirements: ['missing'],
    });
  });
});
