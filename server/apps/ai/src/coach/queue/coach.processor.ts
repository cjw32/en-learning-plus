import { Inject, Injectable, Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  COACH_EXECUTE_JOB,
  COACH_QUEUE_NAME,
  CoachJobData,
  parseCoachJobData,
} from './coach.queue';
import { CoachCancellationService } from '../governance/coach-cancellation.service';
import {
  CoachBudgetService,
  type CoachBudgetUsage,
} from '../governance/coach-budget.service';

class CoachGovernedStepError extends Error {
  constructor(readonly code: 'CANCELLED' | 'TOOL_TIMEOUT' | 'REQUEST_TIMEOUT') {
    super(code);
  }
}

type GovernedStepUsage = CoachBudgetUsage;
export type CoachGovernedStep = Readonly<{
  name: string;
  kind: 'model' | 'tool' | 'write';
  timeoutMs: number;
  projected: GovernedStepUsage;
  run(signal: AbortSignal): Promise<GovernedStepUsage | void>;
}>;

export async function runCoachGovernedSteps(input: {
  budget: CoachBudgetService;
  startedAtMs: number;
  now: () => number;
  signal: AbortSignal;
  steps: readonly CoachGovernedStep[];
}): Promise<void> {
  for (const step of input.steps) {
    if (input.signal.aborted) throw new CoachGovernedStepError('CANCELLED');
    input.budget.assertCanStartNode({
      ...step.projected,
      elapsedMs: input.now() - input.startedAtMs,
    });
    const timeout = new AbortController();
    const signal = AbortSignal.any([input.signal, timeout.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const usage = await Promise.race([
        step.run(signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timeout.abort();
            reject(
              new CoachGovernedStepError(
                step.kind === 'tool' || step.kind === 'write'
                  ? 'TOOL_TIMEOUT'
                  : 'REQUEST_TIMEOUT',
              ),
            );
          }, step.timeoutMs);
        }),
      ]);
      if (input.signal.aborted) throw new CoachGovernedStepError('CANCELLED');
      input.budget.record(
        usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          modelCalls: 0,
          toolCalls: 0,
          costMicros: 0,
        },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const COACH_REQUEST_EXECUTOR = Symbol('COACH_REQUEST_EXECUTOR');

export interface CoachRequestExecutor {
  executeRequest(requestId: string, signal?: AbortSignal): Promise<void>;
}

@Injectable()
@Processor(COACH_QUEUE_NAME)
export class CoachProcessor extends WorkerHost {
  constructor(
    @Inject(COACH_REQUEST_EXECUTOR)
    private readonly executor: CoachRequestExecutor,
    @Optional() private readonly cancellation?: CoachCancellationService,
  ) {
    super();
  }

  async process(job: Job<CoachJobData>): Promise<void> {
    if (job.name !== COACH_EXECUTE_JOB) {
      throw new Error('Unsupported Coach queue job');
    }
    const data = parseCoachJobData(job.data);
    if (String(job.id) !== data.requestId) {
      throw new Error('Coach job ID must equal request ID');
    }
    if (this.cancellation) {
      try {
        await this.cancellation.observe(data.requestId);
      } catch {
        // Durable cancelRequestedAt is checked again after the request is claimed.
      }
      await this.executor.executeRequest(
        data.requestId,
        this.cancellation.abortSignalFor(data.requestId),
      );
      return;
    }
    await this.executor.executeRequest(data.requestId);
  }
}
