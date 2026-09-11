import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type McpSchemaGeneratorModule = {
  generateMcpCapabilitiesJsonSchema: () => string;
};

const repositoryRoot = resolve(__dirname, '../../../../..');
const generatorPath = resolve(
  repositoryRoot,
  'packages/common/mcp/generate-json-schema.ts',
);
const checkedInSchemaPath = resolve(
  repositoryRoot,
  'specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json',
);

describe('English Learning MCP generated contract', () => {
  it('matches deterministic Zod-derived JSON Schema output byte for byte', () => {
    if (!existsSync(generatorPath)) {
      throw new Error(
        `Missing MCP JSON Schema generator: ${generatorPath}. Implement T016 before accepting this contract.`,
      );
    }

    // The dynamic path keeps this tests-first contract executable before T016 exists.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generator = require(generatorPath) as McpSchemaGeneratorModule;
    expect(typeof generator.generateMcpCapabilitiesJsonSchema).toBe('function');

    const firstGeneration = generator.generateMcpCapabilitiesJsonSchema();
    const secondGeneration = generator.generateMcpCapabilitiesJsonSchema();
    expect(secondGeneration).toBe(firstGeneration);

    const checkedInSchema = readFileSync(checkedInSchemaPath, 'utf8');
    expect(checkedInSchema).toBe(firstGeneration);
  });
});
