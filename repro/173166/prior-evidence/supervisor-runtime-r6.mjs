import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const results = [];
const variants = process.argv[2] ? [process.argv[2]] : ['main', 'release'];
for (const variant of variants) for (const scenario of ['runtime-lazy', 'runtime-lazy-gc']) {
  const started = performance.now(), serverEvents = [], connections = new Map(), heldBodies = new Map();
  let socketSequence = 0, requestSequence = 0;
  const record = (event, fields = {}) => serverEvents.push({ms: Math.round(performance.now() - started), event, ...fields});
  const server = http.createServer(async (req, res) => {
    const socket = connections.get(req.socket), request = `server-request${++requestSequence}`;
    let text = ''; for await (const part of req) text += part;
    const rpc = text ? JSON.parse(text) : null;
    record('server.request', {socket, request, path: req.url, method: req.method, rpcMethod: rpc?.method ?? null, rpcId: rpc?.id ?? null, hasSessionHeader: req.headers['mcp-session-id'] !== undefined});
    res.on('finish', () => record('server.response.finish', {socket, request}));
    res.on('close', () => {heldBodies.delete(request); record('server.response.close', {socket, request});});
    if (req.method === 'DELETE') {res.writeHead(405); res.end(); return;}
    if (req.method === 'GET') {
      if (req.url === '/alpha') {res.writeHead(405); res.end(); return;}
      res.writeHead(200, {'content-type': 'text/event-stream'}); res.write(': synthetic-beta-notification-stream\n\n');
      heldBodies.set(request, {request, socket, path: req.url, method: 'GET'}); return;
    }
    if (rpc?.id === undefined) {res.writeHead(202); res.end(); return;}
    const result = rpc.method === 'initialize' ? {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: `synthetic-${req.url.slice(1)}`, version: '4.0.0'}}
      : rpc.method === 'tools/call' ? {content: [{type: 'text', text: rpc.params.arguments.value}], isError: false}
      : {tools: [{name: 'synthetic_echo', description: 'Credential-free read-only echo fixture', inputSchema: {type: 'object', properties: {value: {type: 'string'}}}}]};
    // Deliberately stateless: no MCP-Session-Id in any response.
    if (req.url === '/alpha') {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.end(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: rpc.id, result})}\n\n`);
      record('server.post_rpc_result_sent_body_closed', {request, socket, rpcMethod: rpc.method}); return;
    }
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({jsonrpc: '2.0', id: rpc.id, result}));
  });
  server.on('connection', socket => {
    const label = `server-socket${++socketSequence}`; connections.set(socket, label);
    socket.on('close', () => {connections.delete(socket); record('server.socket.close', {socket: label});});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['--max-old-space-size=768', '--expose-gc', ...(variant === 'main' ? ['--import', new URL('./node_modules/tsx/dist/esm/index.mjs', import.meta.url).pathname] : []), new URL('./client-runtime-r6.mjs', import.meta.url).pathname, `http://127.0.0.1:${server.address().port}`, scenario, variant], {env: {PATH: process.env.PATH, HOME: '/home/fixture', OPENCLAW_STATE_DIR: '/home/fixture/state', XDG_CONFIG_HOME: '/home/fixture/config', OPENCLAW_LOG_LEVEL: 'silent', TSX_DISABLE_CACHE: '1', TSX_TSCONFIG_PATH: new URL('./source/tsconfig.json', import.meta.url).pathname}, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', killed = false, heldBodiesAtCleanup = null;
  child.stdout.on('data', data => {stdout += data; if (heldBodiesAtCleanup === null && stdout.includes('"event":"cleanup.complete"')) heldBodiesAtCleanup = [...heldBodies.values()];});
  child.stderr.on('data', data => stderr += data);
  const timer = setTimeout(() => {killed = true; record('supervisor.deadline', {heldBodies: [...heldBodies.values()]}); child.kill('SIGKILL');}, 30000);
  const [code, signal] = await once(child, 'exit'); clearTimeout(timer);
  record('supervisor.child_joined', {code, signal, killed});
  const openServerConnectionsAtChildExit = [...connections.values()], heldBodiesAtChildExit = [...heldBodies.values()];
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const events = stdout.trim().split('\n').filter(Boolean).map(line => {try {return JSON.parse(line);} catch {return {unparsed: line};}});
  const beforeExit = events.find(e => e.event === 'process.beforeExit');
  const assertions = {
    naturalChildExitZero: !killed && code === 0 && signal === null,
    actualRuntimeCachedCatalogOnly: events.some(e => e.event === 'peekCatalog.complete' && e.serverCount === 2 && e.toolCount === 2 && e.diagnostics === 0),
    actualRuntimeLazyReadCalls: [['synthetic_alpha',1],['synthetic_alpha',2],['synthetic_alpha',3],['synthetic_beta',1],['synthetic_beta',2],['synthetic_alpha',4]].every(([serverName, i]) => events.some(e => e.event === 'runtime.echo.complete' && e.serverName === serverName && e.sequence === i && e.text === `synthetic-${i}`)),
    noExplicitCatalogPrewarm: events.some(e => e.event === 'fixture.lazy_start.no_getCatalog') && !events.some(e => e.event === 'catalog.complete'),
    actualRuntimeDisposeAndJoin: events.some(e => e.event === 'runtime.dispose.complete') && events.some(e => e.event === 'runtime.join.complete'),
    noSessionHeadersOrDeletes: serverEvents.filter(e => e.event === 'server.request').every(e => !e.hasSessionHeader && e.method !== 'DELETE'),
    expectedGcControl: scenario !== 'runtime-lazy-gc' || events.some(e => e.event === 'fixture.gc.complete'),
    outputComplete: events.some(e => e.event === 'output.complete'),
    noTcpAtBeforeExit: Boolean(beforeExit) && !beforeExit.resources.TCPSocketWrap,
    noServerSocketsAtChildExit: openServerConnectionsAtChildExit.length === 0,
    noHeldBodiesAtChildExit: heldBodiesAtChildExit.length === 0,
  };
  const row = {variant, scenario, elapsedMs: Math.round(performance.now() - started), naturalExit: !killed, code, signal, assertions, heldBodiesAtCleanup, heldBodiesAtChildExit, openServerConnectionsAtChildExit, events, serverEvents, stderr};
  results.push(row); console.log(JSON.stringify({variant, scenario, elapsedMs: row.elapsedMs, naturalExit: row.naturalExit, code, signal, assertions, heldBodiesAtChildExit, stderr: stderr.slice(0,1500)}));
}
fs.writeFileSync(process.env.FIXTURE_RESULT ?? '/home/fixture/runtime-r6.json', JSON.stringify({currentMainSourcePin: 'fc5d78172cde956a98d2aab3d66c8cabe65fab69', currentMainSdkVersion: '1.32.1', installedRelease: '2026.10.3', installedReleaseSdkVersion: '1.31.0', node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, supervisorBudgetMs: 30000, rpcTimeoutMs: 1500, noExplicitGetCatalogPrewarm: true, alphaPostSseBody: 'closed after valid RPC result', betaNotificationGet: 'HTTP200 body held until client cleanup', isolation: {networkInterfaces: Object.keys(os.networkInterfaces()), home: process.env.HOME, credentialEnvKeys: Object.keys(process.env).filter(k => /TOKEN|KEY|SECRET|PASSWORD|AUTH|PROXY/i.test(k))}, results}, null, 2), {flag: 'wx'});
if (results.some(row => Object.values(row.assertions).some(passed => !passed))) process.exitCode = 1;
