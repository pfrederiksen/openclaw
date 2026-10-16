import fs from 'node:fs';
import {installObserver} from './observer.mjs';
const [origin,scenario,mode]=process.argv.slice(2);
const {emit,resources}=installObserver(mode==='observed');
emit('runtime.import.begin');
const {createSessionMcpRuntime}=await import('./source/src/agents/agent-bundle-mcp-runtime.ts');
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
  catch(error) {if (!error.message.includes('404')) throw error;emit('runtime.expected_expiration');}
  await call('replacement');
  await waitForGets(2);
}
emit('runtime.dispose.begin');
await runtime.dispose();emit('runtime.dispose.complete');
await runtime.joinCleanup();emit('runtime.join.complete');
emit('cleanup.complete',{resources:resources()});
emit('output.complete');
