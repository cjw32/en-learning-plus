import { CoachTraceService } from './coach-trace.service';

/** Minimal provider-neutral callbacks used by LangChain model adapters. */
export class CoachLangChainCallbacks {
  private firstTokenRecorded = false;

  constructor(
    private readonly trace: CoachTraceService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  onModelStart(input: { inputTokens: number }): void {
    this.trace.recordModelStart(input.inputTokens);
  }

  onFirstToken(): void {
    if (this.firstTokenRecorded) return;
    this.firstTokenRecorded = true;
    this.trace.recordFirstToken(this.now());
  }

  onModelEnd(input: {
    outputTokens: number;
    estimatedCostMicros: number;
  }): void {
    this.trace.recordModelEnd(
      input.outputTokens,
      input.estimatedCostMicros,
    );
  }
}
