import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import {AsyncLocalStorage} from 'node:async_hooks';

export function installOwnershipObserver(Agent, StreamableHTTPClientTransport, sink) {
  const start = performance.now();
  const emit = (event, fields={}) => { try { sink({ms:Math.round(performance.now()-start), event, ...fields}); } catch {} };
  const resources = () => process.getActiveResourcesInfo().reduce((out,name)=>(out[name]=(out[name]??0)+1,out),{});
  process.on('beforeExit', code=>emit('process.beforeExit',{code,resources:resources()}));
  process.on('exit', code=>emit('process.exit',{code}));
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
    emit('signal.any',{...owner(),inputs:Array.isArray(signals)?signals.map(signal=>id(signal,'signal')):[],output:id(result,'signal')});
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
      return result;
    };
  }
  const dispatch=Agent.prototype.dispatch;
  Agent.prototype.dispatch=function(options,handler) {
    const previous=activeDispatcher;
    activeDispatcher=id(this,'dispatcher');
    dispatcherOwners.set(this,owner());
    emit('dispatcher.dispatch',{...owner(),dispatcher:activeDispatcher,method:['GET','POST','DELETE','HEAD'].includes(options.method)?options.method:'OTHER'});
    try {return dispatch.call(this,options,handler);} finally {activeDispatcher=previous;}
  };
  for (const method of ['close','destroy']) {
    const original=Agent.prototype[method];
    Agent.prototype[method]=function(...args) {
      const fields={...dispatcherOwners.get(this),dispatcher:id(this,'dispatcher'),source:source()};
      emit(`dispatcher.${method}.begin`,fields);
      const result=original.apply(this,args);
      return result;
    };
  }
  for (const name of ['create','headers','trailers','error']) dc.subscribe(`undici:request:${name}`,({request,response,error})=>{
    if (name==='create') requestOwners.set(request,{...owner(),dispatcher:activeDispatcher});
    emit(`request.${name}`,{...requestOwners.get(request),request:id(request,'request'),method:['GET','POST','DELETE','HEAD'].includes(request.method)?request.method:'OTHER',...(response?{status:response.statusCode}:{}),...(error?{error:/^(?:UND_ERR_[A-Z_]+|AbortError|TimeoutError|TypeError|Error)$/.test(error.code??error.name)?(error.code??error.name):'OtherError'}:{})});
  });
  dc.subscribe('undici:client:sendHeaders',({request,socket})=>emit('request.socket',{...requestOwners.get(request),request:id(request,'request'),socket:id(socket,'socket')}));
  dc.subscribe('undici:client:connected',({socket})=>{
    const socketId=id(socket,'socket');emit('socket.connected',{socket:socketId});
    socket.once('close',()=>emit('socket.closed',{socket:socketId}));
  });
  return {emit,resources};
}


