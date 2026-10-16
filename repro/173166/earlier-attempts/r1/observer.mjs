import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Agent} from 'undici';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function installObserver(enabled) {
  const start = performance.now();
  const emit = (event, fields={}) => fs.writeSync(1, JSON.stringify({ms:Math.round(performance.now()-start), event, ...fields})+'\n');
  const resources = () => process.getActiveResourcesInfo().reduce((out,name)=>(out[name]=(out[name]??0)+1,out),{});
  process.on('beforeExit', code=>emit('process.beforeExit',{code,resources:resources()}));
  process.on('exit', code=>emit('process.exit',{code}));
  if (!enabled) return {emit,resources};
  const ids = new WeakMap(), readerStreams = new WeakMap(), requestOwners = new WeakMap(), dispatcherOwners = new WeakMap();
  const generations = new WeakMap(), context = new AsyncLocalStorage();
  let sequence=0, activeDispatcher=null;
  const id = (object,prefix) => {
    if (!object || (typeof object!=='object'&&typeof object!=='function')) return null;
    if (!ids.has(object)) ids.set(object,`${prefix}${++sequence}`);
    return ids.get(object);
  };
  const owner = () => context.getStore() ?? {};
  const source = () => {
    const stack = new Error().stack ?? '';
    if (stack.includes('releaseDispatcher')) return 'guarded-fetch-release';
    if (stack.includes('StreamableHTTPClientTransport.close')) return 'sdk-transport-close';
    if (stack.includes('agent-bundle-mcp-runtime')) return 'runtime-lifecycle';
    return 'other';
  };
  const startTransport=StreamableHTTPClientTransport.prototype.start;
  StreamableHTTPClientTransport.prototype.start=function(...args) {
    const transport=id(this,'transport');
    const result=startTransport.apply(this,args);
    emit('transport.start',{transport, signal:id(this._abortController?.signal,'signal')});
    return result;
  };
  const notify=StreamableHTTPClientTransport.prototype._startOrAuthSse;
  StreamableHTTPClientTransport.prototype._startOrAuthSse=function(...args) {
    const transport=id(this,'transport'), notificationGeneration=(generations.get(this)??0)+1;
    generations.set(this,notificationGeneration);
    const fields={transport,notificationGeneration,signal:id(this._abortController?.signal,'signal')};
    emit('notification.begin',fields);
    return context.run(fields,()=>notify.apply(this,args));
  };
  for (const method of ['send','close']) {
    const original=StreamableHTTPClientTransport.prototype[method];
    StreamableHTTPClientTransport.prototype[method]=function(...args) {
      const fields={transport:id(this,'transport'),signal:id(this._abortController?.signal,'signal')};
      emit(`transport.${method}`,fields);
      return context.run(fields,()=>original.apply(this,args));
    };
  }
  const abort=AbortController.prototype.abort;
  AbortController.prototype.abort=function(...args) {
    emit('controller.abort',{...owner(),controller:id(this,'controller'),signal:id(this.signal,'signal'),alreadyAborted:this.signal.aborted,source:source()});
    return abort.apply(this,args);
  };
  const any=AbortSignal.any;
  AbortSignal.any=function(signals) {
    const result=any.call(this,signals);
    emit('signal.any',{...owner(),inputs:signals.map(signal=>id(signal,'signal')),output:id(result,'signal')});
    return result;
  };
  const getReader=ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader=function(...args) {
    const result=getReader.apply(this,args);
    readerStreams.set(result,this);
    if (owner().transport) emit('stream.reader',{...owner(),stream:id(this,'stream'),reader:id(result,'reader')});
    return result;
  };
  for (const [type,prototype] of [['stream',ReadableStream.prototype],['reader',ReadableStreamDefaultReader.prototype]]) {
    const cancel=prototype.cancel;
    prototype.cancel=function(...args) {
      const fields={...owner(),[type]:id(this,type),...(type==='reader'?{stream:id(readerStreams.get(this),'stream')}:{})};
      emit(`${type}.cancel.begin`,fields);
      const result=cancel.apply(this,args);
      void result.then(()=>emit(`${type}.cancel.settled`,fields),error=>emit(`${type}.cancel.rejected`,{...fields,error:error.name}));
      return result;
    };
  }
  const dispatch=Agent.prototype.dispatch;
  Agent.prototype.dispatch=function(options,handler) {
    const previous=activeDispatcher;
    activeDispatcher=id(this,'dispatcher');
    dispatcherOwners.set(this,owner());
    emit('dispatcher.dispatch',{...owner(),dispatcher:activeDispatcher,method:options.method});
    try {return dispatch.call(this,options,handler);} finally {activeDispatcher=previous;}
  };
  for (const method of ['close','destroy']) {
    const original=Agent.prototype[method];
    Agent.prototype[method]=function(...args) {
      const fields={...dispatcherOwners.get(this),dispatcher:id(this,'dispatcher'),source:source()};
      emit(`dispatcher.${method}.begin`,fields);
      const result=original.apply(this,args);
      if (result?.then) void result.then(()=>emit(`dispatcher.${method}.settled`,fields),error=>emit(`dispatcher.${method}.rejected`,{...fields,error:error.name}));
      return result;
    };
  }
  for (const name of ['create','headers','trailers','error']) dc.subscribe(`undici:request:${name}`,({request,response,error})=>{
    if (name==='create') requestOwners.set(request,{...owner(),dispatcher:activeDispatcher});
    emit(`request.${name}`,{...requestOwners.get(request),request:id(request,'request'),method:request.method,...(response?{status:response.statusCode}:{}),...(error?{error:error.code??error.name}:{})});
  });
  dc.subscribe('undici:client:sendHeaders',({request,socket})=>emit('request.socket',{...requestOwners.get(request),request:id(request,'request'),socket:id(socket,'socket')}));
  dc.subscribe('undici:client:connected',({socket})=>{
    const socketId=id(socket,'socket');emit('socket.connected',{socket:socketId});
    socket.once('close',()=>emit('socket.closed',{socket:socketId}));
  });
  return {emit,resources};
}
