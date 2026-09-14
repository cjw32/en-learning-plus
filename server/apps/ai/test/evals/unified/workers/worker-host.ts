import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { workerEnvironment, assertCleanCwd } from './environment-guard';
import { safePath } from '../core/control-loader';
import { safeDiagnostic } from '../core/redaction';
import {
  executionItemSchema,
  ExecutionItem,
  ItemResult,
} from '../contracts/run.schema';
import { workerMessageSchema } from '../contracts/worker.schema';

type WorkerRegistration = {
  engine: 'node' | 'ts-node';
  controlRoot: string;
  candidateRoot?: string;
  entry: { path: string; hash: string };
};
export function createWorkerHost(options: {
  registry: Readonly<Record<string, WorkerRegistration>>;
  runRoot: string;
  serverRoot: string;
  environment: NodeJS.ProcessEnv;
  profile: 'quick' | 'full';
  reserve: (call: any) => unknown;
  onDiagnostic?: (diagnostic: string) => void;
}) {
  const registry = structuredClone(options.registry);
  return {
    async execute(
      workerId: string,
      input: ExecutionItem,
      limits: { timeoutMs: number; signal?: AbortSignal },
    ): Promise<ItemResult> {
      if (!Object.hasOwn(registry, workerId))
        throw Error('UNREGISTERED_WORKER');
      if (
        !Number.isSafeInteger(limits.timeoutMs) ||
        limits.timeoutMs <= 0 ||
        limits.timeoutMs > 2147483647
      )
        throw Error('INVALID_TIMEOUT');
      if (limits.signal?.aborted) throw Error('CANCELLED');
      const item = executionItemSchema.parse(input);
      const registration = registry[workerId];
      const entry = safePath(registration.controlRoot, registration.entry.path);
      if (
        createHash('sha256').update(readFileSync(entry)).digest('hex') !==
        registration.entry.hash
      )
        throw Error('WORKER_ENTRY_CHANGED');
      const cwd = assertCleanCwd(mkdtempSync(join(options.runRoot, 'worker-')));
      const env = workerEnvironment(options.environment);
      if (registration.candidateRoot)
        env.UNIFIED_CANDIDATE_ROOT = registration.candidateRoot;
      const args: string[] = [];
      if (registration.engine === 'ts-node') {
        env.TS_NODE_PROJECT = join(options.serverRoot, 'tsconfig.json');
        // A fixed project path is safe; arbitrary compiler or require hooks are not accepted.
        args.push(
          '-r',
          require.resolve('ts-node/register'),
          '-r',
          require.resolve('tsconfig-paths/register'),
        );
      } else if (registration.engine !== 'node')
        throw Error('UNREGISTERED_ENGINE');
      args.push(entry);
      return new Promise<ItemResult>((resolve, reject) => {
        let outcome: ItemResult | undefined;
        let failure: Error | undefined;
        let stderr = '';
        let receivedBytes = 0;
        let child: ChildProcess;
        let ended = false;
        const stop = (reason: string) => {
          failure ??= Error(reason);
          if (child?.pid) {
            try {
              process.kill(
                process.platform === 'win32' ? child.pid : -child.pid,
                'SIGKILL',
              );
            } catch {
              /* already exited */
            }
          }
        };
        const abort = () => stop('CANCELLED');
        let timer: ReturnType<typeof setTimeout> | undefined = undefined;
        function finish(code: number | null) {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          limits.signal?.removeEventListener('abort', abort);
          try {
            rmSync(cwd, { recursive: true, force: true });
          } catch {
            failure ??= Error('CLEANUP_PENDING');
          }
          if (stderr) options.onDiagnostic?.(safeDiagnostic(stderr));
          if (failure) reject(failure);
          else if (code !== 0 || !outcome) reject(Error('WORKER_NO_RESULT'));
          else resolve(outcome);
        }
        try {
          child = spawn(process.execPath, args, {
            cwd,
            env,
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          });
        } catch {
          failure = Error('WORKER_START_FAILED');
          finish(null);
          return;
        }
        timer = setTimeout(() => stop('TIMEOUT'), limits.timeoutMs);
        limits.signal?.addEventListener('abort', abort, { once: true });
        if (limits.signal?.aborted) abort();
        child.stdout?.on('data', (data: Buffer) => {
          receivedBytes += data.length;
          if (receivedBytes > 1024 * 1024) stop('WORKER_OUTPUT_LIMIT');
        });
        child.stderr?.on('data', (data: Buffer) => {
          receivedBytes += data.length;
          stderr = (stderr + data.toString()).slice(0, 8192);
          if (receivedBytes > 1024 * 1024) stop('WORKER_OUTPUT_LIMIT');
        });
        child.on('message', (raw) => {
          if (failure) return;
          receivedBytes += Buffer.byteLength(JSON.stringify(raw), 'utf8');
          if (receivedBytes > 1024 * 1024) {
            stop('WORKER_OUTPUT_LIMIT');
            return;
          }
          const parsed = workerMessageSchema.safeParse(raw);
          if (
            !parsed.success ||
            parsed.data.itemId !== item.itemId ||
            outcome
          ) {
            stop('WORKER_MESSAGE_INVALID');
            return;
          }
          const message = parsed.data;
          if (message.type === 'result') {
            if (
              Object.entries(item).some(
                ([key, value]) => message.result[key] !== value,
              )
            ) {
              stop('WORKER_MESSAGE_INVALID');
              return;
            }
            outcome = message.result;
          } else if (message.type === 'error')
            stop(safeDiagnostic(message.reason));
          else {
            if (
              options.profile === 'quick' ||
              message.call.itemId !== item.itemId
            ) {
              stop('BUDGET_STOPPED');
              return;
            }
            try {
              // This synchronous trusted callback must durably reserve AND dispatch before returning.
              const receipt = options.reserve(message.call);
              if (receipt instanceof Promise)
                throw Error('ASYNC_RESERVATION_FORBIDDEN');
              child.send(
                {
                  type: 'permitted',
                  itemId: item.itemId,
                  callId: message.call.callId,
                  receipt,
                },
                (error) => {
                  if (error) stop('WORKER_IPC_FAILED');
                },
              );
            } catch {
              stop('BUDGET_STOPPED');
            }
          }
        });
        child.on('error', () => {
          failure ??= Error('WORKER_START_FAILED');
        });
        child.on('close', (code) => finish(code));
        child.send({ type: 'execute', item }, (error) => {
          if (error) stop('WORKER_IPC_FAILED');
        });
      });
    },
  };
}
