# OpenClaw #173166: Controlled Evidence, Revision 6

Current-main pin: `fc5d78172cde956a98d2aab3d66c8cabe65fab69`.
Linux, Node `v24.21.0`, current-main MCP SDK `1.32.1`, Undici `8.11.2`.
Separately labeled installed-release controls execute official `2026.10.3`,
including its SDK `1.31.0`, inside the same isolated network namespace.

**Result: these controls did not reproduce the reported deployment hang.**
They do not prove the authenticated remote failure fixed or establish its cause.
They provide real natural subprocess-exit controls, exact synthetic ownership
timelines, and increasingly faithful coverage of the native runtime entry point.

## Reproduce Current Main

Use the supplied expanded `package-r5.json` and `package-lock-r5.json` as
`package.json` and `package-lock.json` in a new fixture directory, alongside the
supplied scripts. Public source/dependency acquisition needs internet; runtime
is isolated and credential-free.

```sh
curl -fL https://codeload.github.com/openclaw/openclaw/tar.gz/fc5d78172cde956a98d2aab3d66c8cabe65fab69 -o current-main.tar.gz
printf '%s\n' 'f7397ef666ea2be43ed82ad3ffabae6749f10fb5d599495fd49b64efa2d37c0f  current-main.tar.gz' | sha256sum -c -
mkdir source
tar -xzf current-main.tar.gz --strip-components=1 -C source
npm ci --ignore-scripts --no-audit --no-fund
node build.mjs
bash run-isolated.sh fresh-seven.json
bash run-isolated-r3.sh fresh-post-sse.json
bash run-isolated-runtime-r5.sh fresh-native-runtime.json
bash run-isolated-runtime-r6.sh fresh-lazy-runtime.json
```

The last two commands also execute the installed-release comparison. On a host
without `/usr/lib/node_modules/openclaw`, pass `main` to the corresponding
`supervisor-runtime-r5.mjs` or `supervisor-runtime-r6.mjs` command in the final
line of its isolation wrapper. The current-main cases execute unmodified source
through the declared `tsx@4.23.15` ESM loader and project tsconfig path mappings;
they do not compile or load the full repository's unreachable plugin graph.

## Isolation And Ownership

Requires Linux/bubblewrap supporting network and PID namespaces. Runtime sees
only loopback, cleared environment, synthetic HOME/state, readonly fixture and
runtime binaries. It cannot access production HOME, credentials, MCP providers,
Gateway, broker, proxy or external network. All tool calls are synthetic echoes.

The supervisor owns the fake HTTP server. It waits for client subprocess exit
**before** closing any server connection. Client code does not force exit,
destroy arbitrary handles, unref observer timers, or reset global dispatchers.
The bounded supervisor kills and reaps only a child that genuinely exceeds its
deadline; such cases are recorded as failures, never natural exits.

Observational hooks preserve original method return values and record synthetic
request/Agent dispatcher/socket IDs, response completion/cancellation, dispatcher
close/destroy settlement, cleanup, output completion and process exit. No private
request headers or provider data are captured. Transient TCP wrappers at cleanup
return are distinguished from resources actually surviving until `beforeExit`.
The intentional nonblocking DELETE cancellation from #141289 remains unchanged.

## Completed Controls

`runtime/expanded-r5-original-seven.json`: ordinary stateful HTTP, DELETE 500,
stalled DELETE response body, notification SSE closure, aborted POST response
stream, legacy SSE, and independent same-process peer ownership. All seven
naturally exit 0; DELETE 500 preserves remote error and cleanup `uncertain`.
The peer still works after another client is disposed and closes independently.

`runtime/expanded-r5-post-sse-three.json`: successful POST SSE RPC result while
the server leaves its body open, sequential read-only echo/tool requests over
multiple open POST streams, and concurrent GET notifications. Initialization
also uses an open POST SSE result. No fetch or custom streaming timeout is added.

`runtime/actual-runtime-stateless-r5.json`: actual
`createSessionMcpRuntime -> getCatalog -> callTool -> dispose -> joinCleanup`
on current main and the official release, with catalog-only, six sequential
calls, and six calls followed by three explicit GC passes. Two stateless fake
servers are configured: alpha replies over open POST SSE and GET 405; beta
replies JSON and holds a GET 200 notification stream. Neither ever sends an
MCP-Session-Id. No DELETE or session-ID header occurs. Release cases also await
the declared process-local state-database close API.

`runtime/direct-lazy-calltool-r6.json`: same actual native runtimes, but **no
explicit getCatalog prewarm**. Direct lazy call order is alpha 1/2/3, beta 1/2,
then alpha 4. Alpha closes each valid POST SSE result; beta returns JSON and
keeps GET 200 SSE open. Only `peekCatalog` is read after all calls. Both no-GC
and three-GC-pass cases naturally exit 0 on main and release. This specifically
covers the original helper's lazy-call shape instead of priming both servers.

All completed matrices above have zero TCP resources at client `beforeExit`,
zero server sockets/bodies at client exit, and no supervisor kill. The full
current-main source imports take roughly 10-14 seconds; the 30-second fixture
supervisor allows cold source startup without changing the 1500-ms RPC budget
or production lifecycle implementation. Official-release runtime cases take
roughly 2-3 seconds.

## Preserved Failures And Limits

Earlier `actual-runtime-stateless-r4.json` includes two 12-second fixture startup
timeouts, before any HTTP request or owner invocation. Its third GC case did
complete naturally. R5 import markers establish why that fixture-only budget
was insufficient; these are not being labeled MCP lifecycle reproductions.

The original minimal package/lock byte snapshots were not retained before
adding pinned TSX/source-runtime dependencies. Earlier result packets and
source/client/supervisor bytes remain intact. R5 freezes the coherent expanded
manifest/lock, and the original seven and three POST-SSE controls were rerun
against that expanded installation. There is no claim of an exact reconstructed
minimal dependency snapshot or a full pnpm repository installation.

No production source, installed package, configuration, credentials, routing,
Gateway, schedule or financial state was changed. No fix PR is proposed.
These synthetic controls do not cover authenticated OAuth, real remote TLS,
proxies, response size/content, reconnect/replacement generations or the full
workload's timing. In particular, passing GC and direct-lazy controls do not
prove those differences irrelevant or establish the observed socket's owner.
