import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installObserver } from './observer-r5.mjs';
const [origin, scenario, variant] = process.argv.slice(2);
const release = variant === 'release';
const require = createRequire(import.meta.url);
const {emit, resources} = installObserver(release ? require('/usr/lib/node_modules/openclaw/node_modules/undici').Agent : undefined);
emit('fixture.runtime_import.start', {variant});
const {createSessionMcpRuntime} = await import(release ? '/usr/lib/node_modules/openclaw/dist/agents/agent-bundle-mcp-runtime.js' : './source/src/agents/agent-bundle-mcp-runtime.ts');
emit('fixture.runtime_import.complete', {variant});
fs.mkdirSync('/home/fixture/workspace', {recursive: true});
const server = path => ({transport: 'streamable-http', url: `${origin}/${path}`, connectionTimeoutMs: 2500, requestTimeoutMs: 1500});
const runtime = await createSessionMcpRuntime({sessionId: 'synthetic-isolated-runtime', workspaceDir: '/home/fixture/workspace', cfg: {mcp: {servers: {synthetic_alpha: server('alpha'), synthetic_beta: server('beta')}}}, manifestRegistry: {plugins: []}});
emit('fixture.lazy_start.no_getCatalog');
const steps = [['synthetic_alpha',1], ['synthetic_alpha',2], ['synthetic_alpha',3], ['synthetic_beta',1], ['synthetic_beta',2], ['synthetic_alpha',4]];
for (const [serverName, sequence] of steps) {
  emit('runtime.lazy_call.start', {serverName, sequence});
  const result = await runtime.callTool(serverName, 'synthetic_echo', {value: `synthetic-${sequence}`});
  emit('runtime.echo.complete', {serverName, sequence, text: result.content[0]?.text});
}
const catalog = runtime.peekCatalog();
emit('peekCatalog.complete', {serverCount: Object.keys(catalog.servers).length, toolCount: catalog.tools.length, diagnostics: catalog.diagnostics?.length ?? 0});
if (scenario === 'runtime-lazy-gc') {
  if (typeof globalThis.gc !== 'function') throw new Error('GC control requires --expose-gc');
  for (let i = 0; i < 3; i++) {await new Promise(resolve => setImmediate(resolve)); globalThis.gc();}
  emit('fixture.gc.complete');
}
await runtime.dispose(); emit('runtime.dispose.complete');
await runtime.joinCleanup(); emit('runtime.join.complete');
if (release) {
  const dist = '/usr/lib/node_modules/openclaw/dist';
  const candidates = fs.readdirSync(dist).filter(name => /^openclaw-state-db-[A-Za-z0-9_-]+\.mjs$/.test(name)).filter(name => {
    const exports = fs.readFileSync(`${dist}/${name}`, 'utf8').match(/export\s*\{([^}]*)\}/s)?.[1] ?? '';
    return /(?:^|,)\s*closeOpenClawStateDatabaseAsync\s*(?:,|$)/.test(exports) && /(?:^|,)\s*openOpenClawStateDatabase\s*(?:,|$)/.test(exports);
  });
  if (candidates.length !== 1) throw new Error('Declared release state-close owner unavailable or ambiguous');
  await (await import(pathToFileURL(`${dist}/${candidates[0]}`).href)).closeOpenClawStateDatabaseAsync();
  emit('release.state_close.complete');
}
emit('cleanup.complete', {result: 'closed', resources: resources()});
emit('output.complete');
