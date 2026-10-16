import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const results = [];
for (const scenario of ['post-sse-one', 'post-sse-many', 'post-sse-notification']) {
  const started = performance.now(), serverEvents = [], connections = new Map(), heldPosts = new Map();
  let socketSequence = 0, requestSequence = 0, notificationStream;
  const record = (event, fields = {}) => serverEvents.push({ms: Math.round(performance.now() - started), event, ...fields});
  const server = http.createServer(async (req, res) => {
    const socket = connections.get(req.socket), request = `server-request${++requestSequence}`;
    let text = ''; for await (const part of req) text += part;
    const rpc = text ? JSON.parse(text) : null;
    record('server.request', {socket, request, method: req.method, rpcMethod: rpc?.method ?? null, rpcId: rpc?.id ?? null});
    res.on('finish', () => record('server.response.finish', {socket, request}));
    res.on('close', () => {heldPosts.delete(request); record('server.response.close', {socket, request});});
    if (req.method === 'DELETE') {res.writeHead(200, {'content-type': 'text/plain'}); res.end('synthetic-delete'); return;}
    if (req.method === 'GET') {
      notificationStream = res;
      res.writeHead(200, {'content-type': 'text/event-stream'}); res.write(': synthetic-notification-stream\n\n'); return;
    }
    if (rpc?.id === undefined) {res.writeHead(202); res.end(); return;}
    const result = rpc.method === 'initialize' ? {protocolVersion: '2025-11-25', capabilities: {tools: {listChanged: true}}, serverInfo: {name: 'synthetic-post-sse-fixture', version: '3.0.0'}}
      : rpc.method === 'tools/call' ? {content: [{type: 'text', text: rpc.params.arguments.value}], isError: false}
      : {tools: [{name: 'synthetic_echo', description: 'Credential-free read-only echo fixture', inputSchema: {type: 'object', properties: {value: {type: 'string'}}}}]};
    res.writeHead(200, {'content-type': 'text/event-stream', 'mcp-session-id': 'synthetic-post-sse-session'});
    res.write(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: rpc.id, result})}\n\n`);
    heldPosts.set(request, {socket, request, rpcMethod: rpc.method, rpcId: rpc.id});
    record('server.post_rpc_result_sent_body_left_open', {socket, request, rpcMethod: rpc.method, rpcId: rpc.id});
    if (scenario === 'post-sse-notification' && rpc.method === 'tools/call' && notificationStream) {
      notificationStream.write(`event: message\ndata: ${JSON.stringify({jsonrpc: '2.0', method: 'notifications/tools/list_changed'})}\n\n`);
      record('server.notification.sent');
    }
  });
  server.on('connection', socket => {
    const label = `server-socket${++socketSequence}`; connections.set(socket, label);
    socket.on('close', () => {connections.delete(socket); record('server.socket.close', {socket: label});});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['--max-old-space-size=256', new URL('./client-r3.mjs', import.meta.url).pathname, `http://127.0.0.1:${server.address().port}/synthetic-mcp`, scenario], {env: {PATH: process.env.PATH, HOME: '/home/fixture', OPENCLAW_STATE_DIR: '/home/fixture/state', XDG_CONFIG_HOME: '/home/fixture/config', OPENCLAW_LOG_LEVEL: 'silent'}, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '', killed = false, heldPostsAtCleanup = null;
  child.stdout.on('data', data => {
    stdout += data;
    if (heldPostsAtCleanup === null && stdout.includes('"event":"cleanup.complete"')) heldPostsAtCleanup = [...heldPosts.values()];
  });
  child.stderr.on('data', data => stderr += data);
  const timer = setTimeout(() => {killed = true; record('supervisor.deadline'); child.kill('SIGKILL');}, 8500);
  const [code, signal] = await once(child, 'exit'); clearTimeout(timer);
  record('supervisor.child_joined', {code, signal, killed});
  const openServerConnectionsAtChildExit = [...connections.values()], heldPostsAtChildExit = [...heldPosts.values()];
  // The client has already exited or been killed and reaped before server cleanup.
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const events = stdout.trim().split('\n').filter(Boolean).map(line => {try {return JSON.parse(line);} catch {return {unparsed: line};}});
  const beforeExit = events.find(e => e.event === 'process.beforeExit');
  const expectedPosts = scenario === 'post-sse-one' ? 2 : 6;
  const assertions = {
    naturalChildExitZero: !killed && code === 0 && signal === null,
    allPostRpcResultsSentWithBodyLeftOpen: serverEvents.filter(e => e.event === 'server.post_rpc_result_sent_body_left_open').length === expectedPosts,
    initialToolsReceived: events.some(e => e.event === 'tools.complete' && e.count === 1),
    sequentialEchoesReceived: scenario === 'post-sse-one' || [1,2,3].every(i => events.some(e => e.event === 'echo.complete' && e.sequence === i && e.text === `synthetic-${i}`)),
    repeatedToolsReceived: scenario === 'post-sse-one' || events.some(e => e.event === 'tools.repeated.complete' && e.count === 1),
    notificationReceived: scenario !== 'post-sse-notification' || events.some(e => e.event === 'notification.received'),
    cleanupClosed: events.some(e => e.event === 'cleanup.complete' && e.result === 'closed'),
    outputComplete: events.some(e => e.event === 'output.complete'),
    noTcpAtBeforeExit: Boolean(beforeExit) && !beforeExit.resources.TCPSocketWrap,
    noServerSocketsAtChildExit: openServerConnectionsAtChildExit.length === 0,
    noPostBodiesAtChildExit: heldPostsAtChildExit.length === 0,
  };
  const row = {scenario, elapsedMs: Math.round(performance.now() - started), naturalExit: !killed, code, signal, assertions, heldPostsAtCleanup, heldPostsAtChildExit, openServerConnectionsAtChildExit, events, serverEvents, stderr};
  results.push(row);
  console.log(JSON.stringify({scenario, elapsedMs: row.elapsedMs, naturalExit: row.naturalExit, code, signal, assertions, cleanup: events.find(e => e.event === 'cleanup.complete'), stderr: stderr.slice(0,500)}));
}
fs.writeFileSync(process.env.FIXTURE_RESULT ?? '/home/fixture/post-sse-r3.json', JSON.stringify({sourcePin: 'fc5d78172cde956a98d2aab3d66c8cabe65fab69', sdkVersion: '1.32.1', node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, noAddedFetchDeadline: true, isolation: {networkInterfaces: Object.keys(os.networkInterfaces()), home: process.env.HOME, credentialEnvKeys: Object.keys(process.env).filter(k => /TOKEN|KEY|SECRET|PASSWORD|AUTH|PROXY/i.test(k))}, results}, null, 2), {flag: 'wx'});
if (results.some(row => Object.values(row.assertions).some(passed => !passed))) process.exitCode = 1;
