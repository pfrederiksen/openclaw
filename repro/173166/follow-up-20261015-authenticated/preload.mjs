import fs from 'node:fs';
import {createRequire} from 'node:module';
import {isMainThread} from 'node:worker_threads';
import {installOwnershipObserver} from './ownership-observer.mjs';

if (isMainThread) {
  const base='/usr/lib/node_modules/openclaw';
  const require=createRequire(`${base}/package.json`);
  const {Agent}=require('undici');
  const {StreamableHTTPClientTransport}=await import(`${base}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js`);
  let records=0,dropped=0;
  const sink=event=>{
    if(records>=10000){dropped++;return;}
    records++;
    fs.writeSync(2,`mcp opaque ownership=${JSON.stringify(event)}\n`);
  };
  const observer=installOwnershipObserver(Agent,StreamableHTTPClientTransport,sink);
  const version=relative=>JSON.parse(fs.readFileSync(`${base}/${relative}/package.json`)).version;
  observer.emit('observer.ready',{node:process.version,openclawVersion:version('.'),sdkVersion:version('node_modules/@modelcontextprotocol/sdk'),undiciVersion:version('node_modules/undici'),instrumentedAgent:true,instrumentedSdkTransport:true});
  process.once('exit',()=>fs.writeSync(2,`mcp opaque observer-complete=${JSON.stringify({records,dropped})}\n`));
}
