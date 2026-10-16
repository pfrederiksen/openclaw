import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import { Agent } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
const start = performance.now();
const events = [];
const ids = new WeakMap();
let seq = 0;
const id = (value, type) => {
  if (!value || !['object', 'function'].includes(typeof value)) return null;
  if (!ids.has(value)) ids.set(value, `${type}${++seq}`);
  return ids.get(value);
};
const emit = (event, fields = {}) => {
  const row = {ms: Math.round(performance.now() - start), event, ...fields};
  events.push(row); fs.writeSync(1, JSON.stringify(row) + '\n');
};
let activeDispatcher = null;
const dispatch = Agent.prototype.dispatch;
Agent.prototype.dispatch = function(options, handler) {
  const previous = activeDispatcher;
  activeDispatcher = id(this, 'dispatcher');
  emit('dispatcher.dispatch', {dispatcher: activeDispatcher, method: options.method, path: options.path});
  try { return dispatch.call(this, options, handler); } finally { activeDispatcher = previous; }
};
for (const method of ['close', 'destroy']) {
  const original = Agent.prototype[method];
  Agent.prototype[method] = function(...args) {
    const dispatcher = id(this, 'dispatcher'); emit(`dispatcher.${method}.start`, {dispatcher});
    const result = original.apply(this, args);
    if (result?.then) void result.then(() => emit(`dispatcher.${method}.settled`, {dispatcher}), error => emit(`dispatcher.${method}.rejected`, {dispatcher, error: error.name}));
    return result;
  };
}
for (const name of ['create', 'headers', 'trailers', 'error']) {
  dc.subscribe(`undici:request:${name}`, ({request, response, error}) => {
    emit(`request.${name}`, {request: id(request, 'request'), dispatcher: activeDispatcher, method: request.method, path: request.path, ...(response ? {status: response.statusCode} : {}), ...(error ? {error: error.code ?? error.name} : {})});
  });
}
dc.subscribe('undici:client:sendHeaders', ({request, socket}) => {
  emit('request.socket', {request: id(request, 'request'), socket: id(socket, 'socket')});
});
dc.subscribe('undici:client:connected', ({socket}) => {
  const socketId = id(socket, 'socket'); emit('socket.connected', {socket: socketId});
  socket.once('close', () => emit('socket.closed', {socket: socketId}));
});
const resources = () => process.getActiveResourcesInfo().reduce((a, name) => ({...a, [name]: (a[name] ?? 0) + 1}), {});
process.on('beforeExit', code => emit('process.beforeExit', {code, resources: resources()}));
process.on('exit', code => emit('process.exit', {code}));
const {buildMcpHttpFetch, OpenClawStreamableHTTPClientTransport, OpenClawSSEClientTransport, disposeMcpClient, connectMcpClient} = await import('./current-main.mjs');
const [url, scenario] = process.argv.slice(2);
const guardedFetchOwner = buildMcpHttpFetch({resourceUrl: url, requestTimeoutMs: 1500});
let fetchSequence = 0;
const guardedFetch = async (input, init) => {
  const fetchId = `fetch${++fetchSequence}`;
  emit('fetch.start', {fetchId, method: init?.method ?? 'GET'});
  const response = await guardedFetchOwner(input, init);
  emit('fetch.response', {fetchId, status: response.status});
  if (response.body) {
    const cancel = response.body.cancel;
    response.body.cancel = function(...args) {
      emit('fetch.body.cancel.start', {fetchId});
      const completion = cancel.apply(this, args);
      void completion.then(() => emit('fetch.body.cancel.settled', {fetchId}), error => emit('fetch.body.cancel.rejected', {fetchId, error: error.name}));
      return completion;
    };
  }
  return response;
};
const isLegacy = scenario === 'legacy-sse';
const transport = isLegacy ? new OpenClawSSEClientTransport(new URL(url), {fetch: guardedFetch}) : new OpenClawStreamableHTTPClientTransport(new URL(url), {fetch: guardedFetch});
const client = new Client({name: 'synthetic-lifecycle-fixture', version: '1.0.0'}, {capabilities: {}});
let peer;
if (scenario === 'peer-control') {
  const peerUrl = new URL('/synthetic-peer', url).href;
  const peerFetch = buildMcpHttpFetch({resourceUrl: peerUrl, requestTimeoutMs: 1500});
  const peerTransport = new OpenClawStreamableHTTPClientTransport(new URL(peerUrl), {fetch: peerFetch});
  const peerClient = new Client({name: 'synthetic-peer-fixture', version: '1.0.0'}, {capabilities: {}});
  await connectMcpClient({client: peerClient, transport: peerTransport, timeoutMs: 2500});
  peer = {client: peerClient, transport: peerTransport, transportType: 'streamable-http'};
  emit('peer.connect.complete');
}
try {
  await connectMcpClient({client, transport, timeoutMs: 2500});
  emit('connect.complete');
  const signal = scenario === 'abort-post' ? AbortSignal.timeout(200) : undefined;
  try {
    const result = await client.listTools(undefined, {timeout: 1500, ...(signal ? {signal} : {})});
    emit('tools.complete', {count: result.tools.length});
  } catch (error) { emit('tools.error', {name: error.name, code: error.code ?? null}); }
} catch (error) { emit('connect.error', {name: error.name, code: error.code ?? null}); }
const closed = await disposeMcpClient({client, transport, transportType: isLegacy ? 'sse' : 'streamable-http', onCleanupError: error => emit('cleanup.remote_error', {name: error.name, code: error.code ?? null})}, 1500);
emit('cleanup.complete', {result: closed, resources: resources()});
if (peer) {
  const result = await peer.client.listTools(undefined, {timeout: 1500});
  emit('peer.tools.after_other_disposal', {count: result.tools.length});
  const peerClosed = await disposeMcpClient(peer, 1500);
  emit('peer.cleanup.complete', {result: peerClosed});
}
emit('output.complete');
