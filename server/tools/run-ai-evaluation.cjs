// Repository-local entry point; preserve the evaluator's exact 0/1/2/3 status.
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const { mkdirSync, lstatSync } = require('node:fs');
const { tmpdir } = require('node:os');
const server = resolve(__dirname, '..');
const args = process.argv.slice(2);
if (!args.length) args.push('run', '--profile', 'synthetic', '--tag', 'business-regression');
if (['run', 'inspect'].includes(args[0]) && !args.some(a => a === '--output' || a.startsWith('--output='))) {
  const output = join(tmpdir(), 'en-ai-evaluation');
  mkdirSync(output, {recursive:true,mode:0o700});
  if(lstatSync(output).isSymbolicLink()) throw Error('UNSAFE_OUTPUT_ROOT');
  args.push('--output', output);
}
const child = spawnSync(process.execPath, [
  '-r', require.resolve('ts-node/register/transpile-only'),
  join(server,'apps/ai/test/evals/unified/cli.ts'), ...args,
], {cwd:resolve(server,'..'), env:{...process.env,TS_NODE_PROJECT:join(server,'tsconfig.json')},stdio:'inherit'});
process.exitCode=child.status ?? 2;
