import { createHash } from 'node:crypto';

export type CoachPromptDefinition = Readonly<{
  name: string;
  version: string;
  template: string;
  allowedVariables: readonly string[];
}>;

export type ResolvedCoachPrompt = CoachPromptDefinition &
  Readonly<{ hash: string }>;

export class CoachPromptRegistry {
  private readonly prompts = new Map<string, ResolvedCoachPrompt>();

  constructor(definitions: readonly CoachPromptDefinition[]) {
    for (const definition of definitions) {
      const key = `${definition.name}:${definition.version}`;
      if (this.prompts.has(key)) throw new Error('Duplicate Prompt version');
      this.prompts.set(
        key,
        Object.freeze({
          ...definition,
          allowedVariables: Object.freeze([...definition.allowedVariables]),
          hash: createHash('sha256').update(definition.template).digest('hex'),
        }),
      );
    }
  }

  resolve(name: string, version: string): ResolvedCoachPrompt {
    const prompt = this.prompts.get(`${name}:${version}`);
    if (!prompt) throw new Error('Unknown Coach Prompt version');
    return prompt;
  }

  render(
    name: string,
    version: string,
    variables: Record<string, string>,
  ): ResolvedCoachPrompt & { rendered: string } {
    const prompt = this.resolve(name, version);
    const supplied = Object.keys(variables);
    if (supplied.some((key) => !prompt.allowedVariables.includes(key))) {
      throw new Error('Prompt variable is not allowed');
    }
    const rendered = prompt.template.replace(
      /\{\{([A-Za-z0-9_]+)\}\}/g,
      (_match, key: string) => {
        if (!Object.hasOwn(variables, key)) {
          throw new Error('Required Prompt variable is missing');
        }
        return variables[key];
      },
    );
    return { ...prompt, rendered };
  }
}
