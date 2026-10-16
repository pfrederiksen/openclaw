import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {installOwnershipObserver} from './strict-observer.mjs';
const [origin,scenario,mode,variant='main']=process.argv.slice(2);
const release=variant==='release', require=createRequire(import.meta.url);
const {Agent}=release?require('/usr/lib/node_modules/openclaw/node_modules/undici'):await import('undici');
const {StreamableHTTPClientTransport}=await import(release?'/usr/lib/node_modules/openclaw/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js':'@modelcontextprotocol/sdk/client/streamableHttp.js');
const start=performance.now();
const emit=(event,fields={})=>fs.writeSync(1,JSON.stringify({ms:Math.round(performance.now()-start),event,...fields})+'\n');
const resources=()=>process.getActiveResourcesInfo().reduce((out,name)=>(out[name]=(out[name]??0)+1,out),{});
if(mode==='observed')installOwnershipObserver(Agent,StreamableHTTPClientTransport,event=>fs.writeSync(1,JSON.stringify(event)+'\n'));
else {
  process.on('beforeExit',code=>emit('process.beforeExit',{code,resources:resources()}));
  process.on('exit',code=>emit('process.exit',{code}));
}
emit('runtime.import.begin');
const {createSessionMcpRuntime}=await import(release?'/usr/lib/node_modules/openclaw/dist/agents/agent-bundle-mcp-runtime.js':'./source/src/agents/agent-bundle-mcp-runtime.ts');
emit('runtime.import.complete');
fs.mkdirSync('/home/fixture/workspace',{recursive:true});
const runtime=createSessionMcpRuntime({sessionId:'synthetic-173166',workspaceDir:'/home/fixture/workspace',cfg:{mcp:{servers:{synthetic:{transport:'streamable-http',url:origin,connectionTimeoutMs:2500,requestTimeoutMs:1500}}}},manifestRegistry:{plugins:[]}});
const call=async action=>{
  const result=await runtime.callTool('synthetic','synthetic_echo',{action});
  const body=JSON.parse(result.content[0].text);
  emit('runtime.call.complete',{action,...body});
  return body;
};
const waitForGets=async minimum=>{
  const started=performance.now();
  while (performance.now()-started<4000) {
    if ((await call('probe')).notificationGets>=minimum) return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Synthetic notification GET count did not arrive');
};
await call('initial');
await waitForGets(1);
if (scenario==='notification-eof'||scenario==='notification-drop') {
  await call('trigger');
  await waitForGets(2);
} else if (scenario==='expired-session') {
  try {await call('expire');throw Error('Expected synthetic expiration');}
  catch(error) {if (error.code!==404) throw error;emit('runtime.expected_expiration');}
  const started=performance.now();
  while(true) {
    try {await call('replacement');break;}
    catch(error) {
      if(!error.message.includes('is not connected')||performance.now()-started>=4000)throw error;
      emit('runtime.waiting_for_background_replacement');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  await waitForGets(2);
}
emit('runtime.dispose.begin');
await runtime.dispose();emit('runtime.dispose.complete');
await runtime.joinCleanup();emit('runtime.join.complete');
if(release) {
  const dist='/usr/lib/node_modules/openclaw/dist';
  const candidates=fs.readdirSync(dist).filter(name=>/^openclaw-state-db-[A-Za-z0-9_-]+\.mjs$/.test(name)).filter(name=>{
    const exports=fs.readFileSync(`${dist}/${name}`,'utf8').match(/export\s*\{([^}]*)\}/s)?.[1]??'';
    return /(?:^|,)\s*closeOpenClawStateDatabaseAsync\s*(?:,|$)/.test(exports)&&/(?:^|,)\s*openOpenClawStateDatabase\s*(?:,|$)/.test(exports);
  });
  if(candidates.length!==1)throw Error('Declared installed state owner is ambiguous');
  await(await import(pathToFileURL(`${dist}/${candidates[0]}`).href)).closeOpenClawStateDatabaseAsync();
  emit('release.state_close.complete');
}
emit('cleanup.complete',{resources:resources()});
emit('output.complete');
