import { Injectable } from '@nestjs/common';
import { ChatDeepSeek } from '@langchain/deepseek';
import { resolveCoachRuntimeConfig } from '../governance/coach-config.schema';
import type {
  CoachStructuredInvocation,
  CoachStructuredModel,
} from './coach-model.gateway';

class CoachModelUnavailableError extends Error {
  readonly code = 'MODEL_UNAVAILABLE';
}

@Injectable()
export class ConfiguredCoachStructuredModel implements CoachStructuredModel {
  async invokeStructured(input: CoachStructuredInvocation): Promise<unknown> {
    const config = resolveCoachRuntimeConfig(process.env);
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!config.liveModelEnabled || !config.modelName || !apiKey) {
      throw new CoachModelUnavailableError('Coach model is not enabled');
    }
    const model = new ChatDeepSeek({
      apiKey,
      model: config.modelName,
      temperature: 0,
      maxTokens: positiveMaxOutputTokens(),
      streaming: false,
    });
    const structured = model.withStructuredOutput<Record<string, unknown>>(
      input.jsonSchema as Record<string, unknown>,
      { name: input.schemaName, includeRaw: true },
    );
    const response = await structured.invoke(input.prompt, {
      signal: input.signal,
    });
    const usage = (
      response.raw as unknown as {
        usage_metadata?: { input_tokens: number; output_tokens: number };
      }
    ).usage_metadata;
    if (
      !usage ||
      !Number.isSafeInteger(usage.input_tokens) ||
      !Number.isSafeInteger(usage.output_tokens)
    ) {
      throw new CoachModelUnavailableError(
        'Model response did not include auditable token usage',
      );
    }
    input.telemetry?.onFirstOutput();
    input.telemetry?.onUsage({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });
    return response.parsed;
  }
}

function positiveMaxOutputTokens() {
  const value = process.env.COACH_MAX_MODEL_OUTPUT_TOKENS_PER_CALL;
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new CoachModelUnavailableError(
      'Approved model output budget is missing',
    );
  }
  return Number(value);
}
