import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
}

describe('Coach tool dependency boundary', () => {
  it('prevents tool adapters from importing Prisma', () => {
    const toolDirectory = resolve(__dirname, '../../src/coach/tools');
    for (const file of sourceFiles(toolDirectory)) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/PrismaService|generated\/prisma|@prisma\//);
    }
  });
});
