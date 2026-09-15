// Compile runtime workspace contracts before starting Nest. Frontend/type consumers
// keep using sources through package export conditions.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
for (const name of ['common', 'config']) {
  const root = path.resolve(__dirname, '../../packages', name);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(source); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      const target = path.join(root, 'dist', path.relative(root, source).replace(/\.ts$/, '.js'));
      const result = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: source,
      });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, result.outputText);
    }
  }
  visit(root);
}
console.log('Workspace runtime contracts built.');
