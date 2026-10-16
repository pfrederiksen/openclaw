import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const scenarios = process.argv.slice(2);
const results = [];
for (const scenario of scenarios.length ? scenarios : ['success', 'delete-error', 'delete-stalled-body', 'sse-close', 'abort-post', 'legacy-sse', 'peer-control']) {
  const started = performance.now();
  const requests = [], connections = new Map();
  let socketSequence = 0, requestSequence = 0, sessionSequence = 0, getCount = 0, legacyStream;
  const record = (event, fields = {}) => requests.push({ms: Math.round(performance.now() - started), event, ...fields});
  const server = http.createServer(async (req, res) => {
    const socket = connections.get(req.socket);
    const request = `server-request${++requestSequence}`;
    let text = ''; for await (const part of req) text += part;
    const rpc = text ? JSON.parse(text) : null;
    record('server.request', {socket, request, path: req.url, method: req.method, rpcMethod: rpc?.method ?? null});
    res.on('finish', () => record('server.response.finish', {socket, request, method: req.method, rpcMethod: rpc?.method ?? null}));
    res.on('close', () => record('server.response.close', {socket, request, method: req.method, rpcMethod: rpc?.method ?? null}));
    if (req.method === 'DELETE') {
      res.writeHead(scenario === 'delete-error' ? 500 : 200, {'content-type': 'text/plain'});
      if (scenario === 'delete-stalled-body') { res.write('synthetic-held-body'); return; }
      res.end('synthetic-delete'); return;
    }
    if (req.method === 'GET') {
      getCount++;
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
      if (scenario === 'legacy-sse') { legacyStream = res; res.write('event: endpoint\ndata: /synthetic-message\n\n'); }
      else if (scenario === 'sse-close' && getCount === 1) res.end(': synthetic-server-close\n\n');
      else res.write(': synthetic-open-stream\n\n');
      return;
    }
    if (!rpc || rpc.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = rpc.method === 'initialize' ? {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'synthetic-fixture', version: '1.0.0'}} : {tools: [{name: 'synthetic_echo', description: 'Credential-free fixture only', inputSchema: {type: 'object'}}]};
    if (scenario === 'abort-post' && rpc.method === 'tools/list') { res.writeHead(200, {'content-type': 'text/event-stream'}); res.write(': synthetic-incomplete-result\n\n'); return; }
    if (scenario === 'legacy-sse') {
      res.writeHead(202); res.end(); legacyStream.write(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: rpc.id, result})}\n\n`); return;
    }
    res.writeHead(200, {'content-type': 'application/json', 'mcp-session-id': `synthetic-session-${++sessionSequence}`});
    res.end(JSON.stringify({jsonrpc: '2.0', id: rpc.id, result}));
  });
  server.on('connection', socket => {
    const label = `server-socket${++socketSequence}`; connections.set(socket, label);
    socket.on('close', () => {connections.delete(socket); record('server.socket.close', {socket: label});});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['--max-old-space-size=256', new URL('./client.mjs', import.meta.url).pathname, `http://127.0.0.1:${server.address().port}/synthetic-mcp`, scenario], {env: {PATH: process.env.PATH, HOME: '/home/fixture', OPENCLAW_STATE_DIR: '/home/fixture/state', XDG_CONFIG_HOME: '/home/fixture/config', OPENCLAW_LOG_LEVEL: 'silent'}, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', killed = false;
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const timer = setTimeout(() => {killed = true; record('supervisor.deadline'); child.kill('SIGKILL');}, 8500);
  const [code, signal] = await once(child, 'exit'); clearTimeout(timer);
  record('supervisor.child_joined', {code, signal, killed});
  const openServerConnectionsAtChildExit = [...connections.values()];
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const events = stdout.trim().split('\n').filter(Boolean).map(line => {try {return JSON.parse(line);} catch {return {unparsed: line};}});
  const row = {scenario, elapsedMs: Math.round(performance.now() - started), naturalExit: !killed, code, signal, openServerConnectionsAtChildExit, events, serverEvents: requests, stderr};
  const beforeExit = events.find(e => e.event === 'process.beforeExit');
  row.assertions = {
    naturalChildExitZero: !killed && code === 0 && signal === null,
    outputComplete: events.some(e => e.event === 'output.complete'),
    noTcpAtBeforeExit: Boolean(beforeExit) && !(beforeExit.resources.TCPSocketWrap),
    zeroServerSocketsAtChildExit: openServerConnectionsAtChildExit.length === 0,
    expectedCleanupResult: events.find(e => e.event === 'cleanup.complete')?.result === (scenario === 'delete-error' ? 'uncertain' : 'closed'),
    expectedReadOutcome: scenario === 'abort-post' ? events.some(e => e.event === 'tools.error') : events.some(e => e.event === 'tools.complete' && e.count === 1),
    remoteErrorPreserved: scenario !== 'delete-error' || events.some(e => e.event === 'cleanup.remote_error' && e.code === 500),
    peerRemainsUsable: scenario !== 'peer-control' || events.some(e => e.event === 'peer.tools.after_other_disposal' && e.count === 1) && events.some(e => e.event === 'peer.cleanup.complete' && e.result === 'closed'),
  };
  results.push(row);
  console.log(JSON.stringify({scenario, elapsedMs: row.elapsedMs, naturalExit: row.naturalExit, code, signal, cleanup: events.find(e => e.event === 'cleanup.complete'), openServerConnectionsAtChildExit, stderr: stderr.slice(0,300)}));
}
fs.writeFileSync(process.env.FIXTURE_RESULT ?? '/home/fixture/results.json', JSON.stringify({node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, isolation: {networkInterfaces: Object.keys(os.networkInterfaces()), home: process.env.HOME, credentialEnvKeys: Object.keys(process.env).filter(k => /TOKEN|KEY|SECRET|PASSWORD|AUTH|PROXY/i.test(k))}, results}, null, 2), {flag: 'wx'});
if (results.some(row => Object.values(row.assertions).some(passed => !passed))) process.exitCode = 1;
