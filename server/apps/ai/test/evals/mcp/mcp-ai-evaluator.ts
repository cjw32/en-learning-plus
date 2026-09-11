export interface McpEvalJudgePort {
  judge(
    input: Readonly<{
      promptVersion: string;
      rubricVersion: string;
      caseId: string;
      candidate: string;
    }>,
  ): Promise<
    Readonly<{
      score: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostMicros: number;
    }>
  >;
}

export class McpAiEvaluator {
  private spentMicros = 0;
  constructor(
    private readonly judge: McpEvalJudgePort,
    private readonly options: Readonly<{
      enabled: boolean;
      approvedBudgetMicros: number;
      promptVersion: 'mcp-eval-judge.v1';
      rubricVersion: 'mcp-rubrics.v1';
      maxCandidateBytes?: number;
    }>,
  ) {}

  async evaluate(caseId: string, candidate: string) {
    if (!this.options.enabled)
      throw new Error('Real-provider evaluation is not explicitly approved');
    if (
      this.options.approvedBudgetMicros <= 0 ||
      this.spentMicros >= this.options.approvedBudgetMicros
    )
      throw new Error('Evaluation budget exceeded');
    if (
      Buffer.byteLength(candidate, 'utf8') >
      (this.options.maxCandidateBytes ?? 32_000)
    )
      throw new Error('Evaluation candidate exceeds bound');
    const result = await this.judge.judge({
      promptVersion: this.options.promptVersion,
      rubricVersion: this.options.rubricVersion,
      caseId,
      candidate,
    });
    if (
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > 1 ||
      result.estimatedCostMicros < 0
    )
      throw new Error('Invalid judge result');
    if (
      this.spentMicros + result.estimatedCostMicros >
      this.options.approvedBudgetMicros
    )
      throw new Error('Evaluation budget exceeded');
    this.spentMicros += result.estimatedCostMicros;
    return Object.freeze({
      ...result,
      caseId,
      promptVersion: this.options.promptVersion,
      rubricVersion: this.options.rubricVersion,
      securityDecisionEligible: false,
    });
  }
}
