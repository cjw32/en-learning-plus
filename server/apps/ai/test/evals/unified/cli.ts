import { resolve } from 'node:path';
import { runEvaluation } from './core/run-coordinator';

if (require.main === module) {
  runEvaluation(process.argv.slice(2), resolve(__dirname, '../../../../../..'))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.exitCode;
    })
    .catch(() => {
      process.stderr.write('EVALUATION_UNAVAILABLE\n');
      process.exitCode = 2;
    });
}
