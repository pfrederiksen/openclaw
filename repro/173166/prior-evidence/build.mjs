import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = import.meta.dirname;
const own = createRequire(import.meta.url);
const declared = JSON.parse(readFileSync(path.join(root, 'source/package.json')));
const dependencies = {};
const result = await build({
  absWorkingDir: root,
  entryPoints: ['entry.ts'], outfile: 'current-main.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24',
  tsconfig: 'source/tsconfig.json', metafile: true,
  plugins: [{name: 'explicit-runtime-dependencies', setup(b) {
    b.onResolve({filter: /^[^./]/}, args => {
      if (args.path.startsWith('node:') || args.path.startsWith('@openclaw/') && !['@openclaw/proxyline', '@openclaw/fs-safe', '@openclaw/proc-safe'].some(p => args.path.startsWith(p))) return;
      const resolved = own.resolve(args.path);
      const name = args.path.startsWith('@') ? args.path.split('/').slice(0,2).join('/') : args.path.split('/')[0];
      let dir = path.dirname(resolved);
      while (dir !== path.dirname(dir)) {
        try {
          const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json')));
          if (pkg.name === name) { dependencies[name] = {actual: pkg.version, declared: declared.dependencies?.[name] ?? declared.devDependencies?.[name] ?? null}; break; }
        } catch {}
        dir = path.dirname(dir);
      }
      return {path: resolved, external: true};
    });
  }}],
});
for (const name of ['@modelcontextprotocol/sdk', 'undici', 'esbuild']) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json')));
  dependencies[name] = {actual: pkg.version, declared: declared.dependencies?.[name] ?? declared.devDependencies?.[name] ?? null};
}
const inputs = Object.keys(result.metafile.inputs).map(file => ({file, sha256: createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')}));
writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify({pin: 'fc5d78172cde956a98d2aab3d66c8cabe65fab69', dependencies, inputs}, null, 2));
console.log(JSON.stringify({inputs: Object.keys(result.metafile.inputs).length, dependencies}));
