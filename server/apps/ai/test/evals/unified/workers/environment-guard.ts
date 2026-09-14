import { readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resourceIdentitySchema } from '../contracts/evidence.schema';

export function workerEnvironment(
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  // No HOME, cwd-based dotenv, node preload, proxy, shell or cloud credential inheritance.
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ'])
    if (parent[key]) env[key] = parent[key];
  return env;
}

export function assertCleanCwd(cwd: string): string {
  if (lstatSync(cwd).isSymbolicLink()) throw Error('UNSAFE_WORKER_CWD');
  const path = realpathSync(cwd);
  if (
    readdirSync(path).some(
      (name) => name === '.env' || name.startsWith('.env.'),
    )
  )
    throw Error('DOTENV_FORBIDDEN');
  return path;
}

export async function verifyResource(
  approved: unknown,
  probe: () => Promise<unknown>,
) {
  const expected = resourceIdentitySchema.parse(approved);
  const actual = resourceIdentitySchema.parse(await probe());
  for (const key of Object.keys(expected) as Array<keyof typeof expected>)
    if (actual[key] !== expected[key]) throw Error('ISOLATION_UNVERIFIED');
  return Object.freeze(actual);
}

export function attachApprovedCredentials(
  env: NodeJS.ProcessEnv,
  credentials: Readonly<Record<string, string>>,
  allowedNames: readonly string[],
): NodeJS.ProcessEnv {
  const forbidden =
    /^(?:NODE_|NPM_|PNPM_|PATH$|HOME$|BASH_ENV$|ENV$|.*PROXY$)/i;
  const result = { ...env };
  for (const [name, value] of Object.entries(credentials)) {
    if (
      !allowedNames.includes(name) ||
      forbidden.test(name) ||
      !/^[A-Z][A-Z0-9_]*$/.test(name) ||
      !value
    )
      throw Error('CREDENTIAL_PROFILE_INVALID');
    result[name] = value;
  }
  return result;
}
