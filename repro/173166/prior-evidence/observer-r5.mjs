import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent } from 'undici';

export function installObserver(AgentType = Agent) {
  const start = performance.now(), ids = new WeakMap(), requestOwners = new WeakMap();
  const fetchContext = new AsyncLocalStorage();
  let seq = 0, activeDispatcher = null, fetchSequence = 0;
  const id = (object, type) => {
    if (!ids.has(object)) ids.set(object, `${type}${++seq}`);
    return ids.get(object);
  };
  const emit = (event, fields = {}) => fs.writeSync(1, JSON.stringify({ms: Math.round(performance.now() - start), event, ...fields}) + '\n');
  const resources = () => process.getActiveResourcesInfo().reduce((a, name) => ({...a, [name]: (a[name] ?? 0) + 1}), {});
  const dispatch = AgentType.prototype.dispatch;
  AgentType.prototype.dispatch = function(options, handler) {
    const previous = activeDispatcher; activeDispatcher = id(this, 'dispatcher');
    emit('dispatcher.dispatch', {dispatcher: activeDispatcher, fetchId: fetchContext.getStore() ?? null, method: options.method, path: options.path});
    try {return dispatch.call(this, options, handler);} finally {activeDispatcher = previous;}
  };
  for (const method of ['close', 'destroy']) {
    const original = AgentType.prototype[method];
    AgentType.prototype[method] = function(...args) {
      const dispatcher = id(this, 'dispatcher'); emit(`dispatcher.${method}.start`, {dispatcher});
      const result = original.apply(this, args);
      if (result?.then) void result.then(() => emit(`dispatcher.${method}.settled`, {dispatcher}), error => emit(`dispatcher.${method}.rejected`, {dispatcher, error: error.name}));
      return result;
    };
  }
  for (const name of ['create', 'headers', 'trailers', 'error']) {
    dc.subscribe(`undici:request:${name}`, ({request, response, error}) => {
      if (name === 'create') requestOwners.set(request, {dispatcher: activeDispatcher, fetchId: fetchContext.getStore() ?? null});
      emit(`request.${name}`, {request: id(request, 'request'), ...requestOwners.get(request), method: request.method, path: request.path, ...(response ? {status: response.statusCode} : {}), ...(error ? {error: error.code ?? error.name} : {})});
    });
  }
  dc.subscribe('undici:client:sendHeaders', ({request, socket}) => emit('request.socket', {request: id(request, 'request'), ...requestOwners.get(request), socket: id(socket, 'socket')}));
  dc.subscribe('undici:client:connected', ({socket}) => {
    const socketId = id(socket, 'socket'); emit('socket.connected', {socket: socketId});
    socket.once('close', () => emit('socket.closed', {socket: socketId}));
  });
  process.on('beforeExit', code => emit('process.beforeExit', {code, resources: resources()}));
  process.on('exit', code => emit('process.exit', {code}));
  const observeFetch = owner => async (input, init) => {
    const fetchId = `fetch${++fetchSequence}`;
    const rpc = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    emit('fetch.start', {fetchId, method: init?.method ?? 'GET', rpcMethod: rpc?.method ?? null, rpcId: rpc?.id ?? null});
    const response = await fetchContext.run(fetchId, () => owner(input, init));
    emit('fetch.response', {fetchId, status: response.status, contentType: response.headers.get('content-type')});
    if (response.body) {
      const cancel = response.body.cancel;
      response.body.cancel = function(...args) {
        emit('fetch.body.cancel.start', {fetchId});
        const result = cancel.apply(this, args);
        void result.then(() => emit('fetch.body.cancel.settled', {fetchId}), error => emit('fetch.body.cancel.rejected', {fetchId, error: error.name}));
        return result;
      };
    }
    return response;
  };
  return {emit, resources, observeFetch};
}
