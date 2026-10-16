import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root = import.meta.dirname;
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package-r5.json')));
const declared = JSON.parse(fs.readFileSync(path.join(root, 'source/package.json')));
const dependencies = Object.entries(packageManifest.dependencies).map(([name, pinned]) => {
  const actual = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))).version;
  const upstream = declared.dependencies?.[name] ?? declared.devDependencies?.[name] ?? null;
  return {name, pinned, actual, upstream, matches: pinned === actual && pinned === upstream};
});
const matrices = ['runtime/expanded-r5-original-seven.json', 'runtime/expanded-r5-post-sse-three.json', 'runtime/actual-runtime-stateless-r5.json', 'runtime/direct-lazy-calltool-r6.json'].map(file => {
  const packet = JSON.parse(fs.readFileSync(path.join(root, file)));
  return {file, sha256: sha(file), scenarios: packet.results.map(row => ({variant: row.variant ?? 'main', scenario: row.scenario, naturalExit: row.naturalExit, code: row.code, elapsedMs: row.elapsedMs, assertionsPass: Object.values(row.assertions).every(Boolean)}))};
});
const files = ['README-R6.md', 'package-r5.json', 'package-lock-r5.json', 'entry.ts', 'build.mjs', 'client.mjs', 'supervisor.mjs', 'run-isolated.sh', 'observer-r3.mjs', 'client-r3.mjs', 'supervisor-r3.mjs', 'run-isolated-r3.sh', 'observer-r5.mjs', 'client-runtime-r5.mjs', 'supervisor-runtime-r5.mjs', 'run-isolated-runtime-r5.sh', 'client-runtime-r6.mjs', 'supervisor-runtime-r6.mjs', 'run-isolated-runtime-r6.sh', 'freeze-r6.mjs', 'source/src/agents/agent-bundle-mcp-runtime.ts', 'source/src/agents/mcp-http-fetch.ts', 'source/src/agents/mcp-http-transport.ts', 'source/src/agents/mcp-client-lifecycle.ts', 'source/src/infra/net/fetch-guard.ts', 'source/src/infra/net/guarded-body-stream.ts'].map(file => ({file, sha256: sha(file)}));
const result = {sourcePin: 'fc5d78172cde956a98d2aab3d66c8cabe65fab69', currentMainArchiveSha256: sha('current-main.tar.gz'), dependencies, matrices, files, allAssertionsPass: matrices.every(m => m.scenarios.every(s => s.assertionsPass && s.naturalExit && s.code === 0)), allDirectDependenciesMatch: dependencies.every(d => d.matches), failingCurrentMainReproductionEstablished: false, productionSourceModified: false};
fs.writeFileSync(path.join(root, 'FROZEN-FIXTURE-EVIDENCE-r6.json'), JSON.stringify(result, null, 2), {flag: 'wx'});
console.log(JSON.stringify({matrices: matrices.length, scenarios: matrices.reduce((n,m) => n + m.scenarios.length, 0), allAssertionsPass: result.allAssertionsPass, allDirectDependenciesMatch: result.allDirectDependenciesMatch}));
if (!result.allAssertionsPass || !result.allDirectDependenciesMatch) process.exitCode = 1;
