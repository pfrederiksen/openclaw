import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const results=[];
for (const variant of (process.argv[2]?[process.argv[2]]:['main','release'])) for (const mode of ['observed','plain']) for (const scenario of (process.argv[3]?[process.argv[3]]:variant==='release'?['baseline']:['baseline','notification-eof','notification-drop','expired-session'])) {
  const started=performance.now(),serverEvents=[],connections=new Map(),heldBodies=new Map();
  let socketSequence=0,requestSequence=0,notificationGets=0,sessionGeneration=0,activeNotification;
  const record=(event,fields={})=>serverEvents.push({ms:Math.round(performance.now()-started),event,...fields});
  const server=http.createServer(async(req,res)=>{
    const socket=connections.get(req.socket),request=`request${++requestSequence}`;
    let text='';for await(const part of req) text+=part;
    const rpc=text?JSON.parse(text):null;
    record('server.request',{socket,request,method:req.method,rpcMethod:rpc?.method??null,sessionGeneration});
    res.on('close',()=>{heldBodies.delete(request);record('server.response.close',{request,socket});});
    if(req.method==='DELETE'){res.writeHead(200);res.end();return;}
    if(req.method==='GET'){
      notificationGets++;
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.write('id: synthetic\nretry: 10\n\n');
      heldBodies.set(request,{request,socket,notificationGeneration:notificationGets});
      activeNotification=res;return;
    }
    if(rpc?.id===undefined){res.writeHead(202);res.end();return;}
    if(rpc.method==='initialize')sessionGeneration++;
    const action=rpc.params?.arguments?.action;
    if(action==='trigger'&&activeNotification){
      if(scenario==='notification-eof')activeNotification.end();
      else if(scenario==='notification-drop')activeNotification.destroy();
      record('server.synthetic_notification_end',{kind:scenario});
    }
    if(action==='expire'){res.writeHead(404);res.end();return;}
    const result=rpc.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1.0.0'}}
      :rpc.method==='tools/list'?{tools:[{name:'synthetic_echo',inputSchema:{type:'object',properties:{action:{type:'string'}}}}]}
      :{content:[{type:'text',text:JSON.stringify({notificationGets,sessionGeneration})}],isError:false};
    res.writeHead(200,{'content-type':'application/json',...(scenario==='expired-session'?{'mcp-session-id':`synthetic-session-${sessionGeneration}`}:{})});
    res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}));
  });
  server.on('connection',socket=>{const label=`socket${++socketSequence}`;connections.set(socket,label);socket.on('close',()=>{connections.delete(socket);record('server.socket.close',{socket:label});});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const child=spawn(process.execPath,['--max-old-space-size=768',...(variant==='main'?['--import',new URL('./node_modules/tsx/dist/esm/index.mjs',import.meta.url).pathname]:[]),new URL('./client.mjs',import.meta.url).pathname,`http://127.0.0.1:${server.address().port}`,scenario,mode,variant],{env:{HOME:'/home/fixture',PATH:'/usr/bin:/bin',OPENCLAW_STATE_DIR:'/home/fixture/state',XDG_CONFIG_HOME:'/home/fixture/config',OPENCLAW_LOG_LEVEL:'silent',TSX_DISABLE_CACHE:'1',TSX_TSCONFIG_PATH:new URL('./source/tsconfig.json',import.meta.url).pathname},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',killed=false;
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>{killed=true;record('supervisor.deadline',{heldBodies:[...heldBodies.values()]});child.kill('SIGKILL');},45000);
  const [code,signal]=await once(child,'exit');clearTimeout(timer);
  record('supervisor.child_joined',{code,signal,killed});
  const openSocketsAtChildExit=[...connections.values()],heldBodiesAtChildExit=[...heldBodies.values()];
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const events=stdout.trim().split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return{unparsed:line};}});
  const beforeExit=events.find(event=>event.event==='process.beforeExit');
  const assertions={naturalExitZero:!killed&&code===0&&signal===null,cleanupJoined:events.some(event=>event.event==='runtime.join.complete'),outputComplete:events.some(event=>event.event==='output.complete'),noTcpAtBeforeExit:Boolean(beforeExit)&&!beforeExit.resources.TCPSocketWrap,noServerSocketsAtChildExit:openSocketsAtChildExit.length===0,noHeldBodiesAtChildExit:heldBodiesAtChildExit.length===0,expectedGetGenerations:notificationGets>=(scenario==='baseline'?1:2),expectedSessionReplacement:scenario!=='expired-session'||sessionGeneration===2,observedDispatcherOwnership:mode==='plain'||events.some(event=>event.event==='request.socket'&&event.dispatcher&&event.transport&&event.notificationGeneration)};
  const row={variant,scenario,mode,elapsedMs:Math.round(performance.now()-started),code,signal,killed,notificationGets,sessionGeneration,assertions,openSocketsAtChildExit,heldBodiesAtChildExit,events,serverEvents,stderr};results.push(row);
  console.log(JSON.stringify({...row,events:undefined,serverEvents:undefined}));
}
const out={sourcePin:'eb5b351e0f94dc7bf3f0390dd31064cad2ab9934',node:process.version,platform:`${os.platform()} ${os.release()} ${os.arch()}`,supervisorBudgetMs:45000,syntheticRpcBudgetMs:1500,isolation:{interfaces:Object.keys(os.networkInterfaces()),home:process.env.HOME,credentialEnvironmentKeys:Object.keys(process.env).filter(key=>/TOKEN|KEY|SECRET|PASSWORD|AUTH|PROXY/i.test(key))},results};
fs.writeFileSync(process.env.FIXTURE_RESULT,JSON.stringify(out,null,2)+'\n',{flag:'wx'});
if(results.some(row=>Object.values(row.assertions).some(value=>!value)))process.exitCode=1;
