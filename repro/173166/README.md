# OpenClaw #173166: Independently Runnable Ownership Controls

**Result: no failing credential-free reproduction of the reported terminal hang.**
All ten final controls naturally exit zero. These are negative controls and
owner-instrumentation validation, not a fix or a replacement for the observed
authenticated release failure. No production provider is contacted.

## Exact Source And Environment

- Source pin: `eb5b351e0f94dc7bf3f0390dd31064cad2ab9934`, the commit cited by
  ClawSweeper's latest issue review, not a floating main checkout.
- Linux / Node `v24.21.0`; MCP SDK `1.32.1`; Undici `8.11.2` for pinned source.
- Two separately labeled baseline controls use the unmodified installed official
  OpenClaw `2026.10.3` with its actual SDK `1.31.0` and installed Undici.
- Exact expanded npm manifest and lockfile included. Source runs with the declared
  TSX loader; this is not a full pnpm repository install. No installed core edits.
- `SOURCE-PIN.json` freezes the downloaded archive digest and relevant source
  blobs. The listed lifecycle files are unchanged from the earlier control pin.

## Run

On a clean Linux host with Node 24, bubblewrap, curl, npm and network access for
public source/dependency acquisition:

```sh
bash prepare.sh
bash run-isolated.sh independent-main.json main
```

One focused observed/plain reconnect pair:

```sh
bash run-isolated.sh independent-eof.json main notification-eof
```

The optional official-release baseline requires that release installed at
`/usr/lib/node_modules/openclaw`; it does not install or update it:

```sh
bash run-isolated.sh independent-release.json release baseline
```

With no variant argument, the wrapper runs the eight pinned-source controls and
two installed-release baseline controls. Choose unique JSON output basenames.
Acquisition happens before runtime isolation. Child execution has a cleared
environment, synthetic HOME/state, network and PID namespaces, and loopback only.
No host credentials, broker, OAuth tokens, Gateway or external endpoint are
available to the runtime. Every tool is a synthetic read-only echo.

## Final Matrix

`results/generation-matrix-r3.json`: four pinned-source scenarios, each observed
and plain (eight cases), plus the installed-release baseline pair (ten total):

1. Open notification GET 200 SSE, then ordinary disposal and joinCleanup.
2. Server ends its first notification body; the SDK opens a second notification
   GET on the same transport; the second body stays open until native cleanup.
3. Server abruptly drops the first notification socket; a second GET recovers,
   and its body stays open until native cleanup.
4. A synthetic stateful tool read returns HTTP 404. The failed call is not
   replayed. A subsequent independent read waits for native background catalog
   recovery and creates a second transport/session generation, then disposes.

All ten have natural subprocess exit 0, zero TCP resources at beforeExit, zero
server sockets and held bodies at child exit, and no supervisor kill. The parent
waits for child exit before closing any server connection. Its 45-second fixture
supervisor allows cold TSX source imports; the synthetic RPC budget remains
1500 ms. No production timeout was changed.

## What Ownership Is Actually Observed

`OWNER-SUMMARY.json` extracts actual synthetic GET request -> socket -> explicit
Agent dispatcher -> SDK transport and notification-generation identities from
the complete event packet. Native AbortController.abort and AbortSignal.any
input/output identities connect transport cancellation with request signals.
Reader/cancel and dispatcher close/destroy invocations are recorded without
changing their receiver, arguments, returned promise or reference state.

The strict observer adds **no Promise settlement or rejection handlers**. It
does not force exit, reset a global dispatcher, destroy arbitrary handles, alter
abort signals, unref resources, change cleanup or touch another runtime. Paired
observed/plain cases pass, including exact installed SDK/Agent class identity.
Instrumentation still allocates metadata, inspects transient stacks and performs
synchronous writes, so these controls do not prove zero timing influence.

`guarded-fetch-release` is a fixed enum derived from a transient `releaseDispatcher`
stack frame; it is not interception of the lexical release callback or proof of
that callback's Promise outcome. Minified/missing frames stay unknown. SDK
transport IDs identify client/transport generations, not hidden runtime closure
identity. Null dispatcher associations stay unknown. Reader cancellation events
are invocations, not claims of fulfillment. Repeated close invocations may be
Agent's callback/promise overload re-entry; do not count them as distinct leaks.

## Preserved Earlier Attempts

`earlier-attempts/r1` preserves the first matrix and harness: six controls pass,
but the fixture checked an expected HTTP 404's message instead of typed `.code`.
`earlier-attempts/r2` fixes that check, then preserves the first immediate
replacement-read failure while native catalog recovery is still in progress.
Neither is the reported post-cleanup terminal hang: both error cases exit code 1
and leave no server sockets. R3 uses a bounded read-only readiness wait, with no
runtime/source modification or replay of the failed read. Sanitized views replace
only private local path prefixes; original hashes remain in provenance metadata.

## Prior Evidence And Remaining Gap

`prior-evidence/` contains the exact 31 previously published sanitized files,
including all twenty passing earlier controls, their coordinator reruns, exact
package lock and the authenticated request-17 -> socket-17 trace. Its separate
README explains its older pin and commands. Original file hashes are verified,
not silently overwritten. This repository copy makes inspection independent
of the gist that ClawSweeper could not access.

**The actual surviving deployment GET's dispatcher, abort/release chain and
runtime/reconnect generation remain unidentified.** The new synthetic ownership
trace cannot retrospectively supply those identities. A separately staged
coordinator-only once-only deployment observer exists but is not executed by
these controls. It requires frozen current helper/core hashes, verified backup,
an idle normal-cycle lease and egress gate, exact-child supervision/reaping and
no financial source admission. No authenticated run, failing regression, root
cause patch or repair PR is claimed by this evidence package.
