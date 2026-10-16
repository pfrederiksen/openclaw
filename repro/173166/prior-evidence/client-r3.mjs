import { installObserver } from './observer-r3.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
const {emit, resources, observeFetch} = installObserver();
const {buildMcpHttpFetch, OpenClawStreamableHTTPClientTransport, disposeMcpClient, connectMcpClient} = await import('./current-main.mjs');
const [url, scenario] = process.argv.slice(2);
// No whole-fetch timeout or custom streaming timeout is added to this control.
const guardedFetch = observeFetch(buildMcpHttpFetch({resourceUrl: url}));
const transport = new OpenClawStreamableHTTPClientTransport(new URL(url), {fetch: guardedFetch});
const client = new Client({name: 'synthetic-post-sse-fixture', version: '3.0.0'}, {capabilities: {}});
let notificationCount = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, () => {notificationCount++; emit('notification.received', {count: notificationCount});});
await connectMcpClient({client, transport, timeoutMs: 2500});
emit('connect.complete');
const tools = await client.listTools(undefined, {timeout: 1500});
emit('tools.complete', {count: tools.tools.length});
if (scenario !== 'post-sse-one') {
  for (let i = 1; i <= 3; i++) {
    const result = await client.callTool({name: 'synthetic_echo', arguments: {value: `synthetic-${i}`}}, undefined, {timeout: 1500});
    emit('echo.complete', {sequence: i, text: result.content[0]?.text});
  }
  const repeated = await client.listTools(undefined, {timeout: 1500});
  emit('tools.repeated.complete', {count: repeated.tools.length});
}
const closed = await disposeMcpClient({client, transport, transportType: 'streamable-http', onCleanupError: error => emit('cleanup.remote_error', {name: error.name, code: error.code ?? null})}, 1500);
emit('cleanup.complete', {result: closed, resources: resources(), notificationCount});
emit('output.complete');
