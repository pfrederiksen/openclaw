# One Authenticated Ownership Diagnostic: Natural Exit, Not A Reproduction

On October 15, one coordinator-supervised read-only diagnostic completed on the
unchanged installed official OpenClaw `2026.10.3`, Linux/Node `v24.21.0`, SDK
`1.31.0`, Undici `8.11.2`. It naturally exited 0 without a supervisor kill.
This does **not** explain or repair the earlier authenticated terminal hang.

## Important Source Difference

The current helper had an approved account-identity selector migration. Its
SHA-256 was `4dc2ffd85f4d79af1a342c3a84509acbf861115616c5729613dc02e076740b61`,
not the older helper used for the failing trace. No account identity, nickname,
credentials, private configuration or helper source is included here. The core
was not patched, reset or restarted. This was one new qualified observation,
not a byte-identical rerun of the earlier failed workload.

## Terminal Result And Completeness

`TRACE.json` retains only fixed-schema opaque metadata and fixed helper stages.
All 553 emitted observer records were captured: dropped 0, invalid 0, overlong 0,
over-cap 0. Twenty nonmatching stderr lines were discarded rather than retained.
There were 23 requests, 23 request/socket associations and 23 socket-close events:
21 POST, 2 GET, and no DELETE. All concrete Agent dispatcher identities were
observed. At beforeExit, the only recorded resource was PipeWrap; natural exit
0 followed. No final socket reference/readable/writable flags were sampled.

Helper-relative stages:

```text
runtime.start          0 ms
runtime.ready       4634 ms
cleanup.start      23388 ms
cleanup.complete   23453 ms
emit.complete      23460 ms
```

The helper's cleanup marker follows its declared runtime disposal/cleanup join
and state close; emit.complete follows its stdout-write callback. Stdout was
discarded and no `read_ok`, payload or business-result value was retained.
Therefore this is terminal-lifecycle evidence, **not proof of successful financial
read coverage, permission to trade or source admission**. Financial actions and
trading-state writes were zero.

Observer timestamps use a different clock origin. Do not subtract the helper
stage clock from observer event times.

## Actual New Request Ownership

The first notification request was GET `request54 -> socket61`, owned by concrete
Agent `dispatcher53`, SDK `transport1`, notification generation 1, `signal2`.
It returned HTTP 405 and its socket closed at observer 9334 ms.

The second was GET `request356 -> socket363`, concrete Agent `dispatcher355`,
SDK `transport297`, generation 1, `signal298`. It returned HTTP 200. Its observed
teardown, on the observer-relative clock:

```text
23406 ms  SDK close and native abort of signal298
23407 ms  request356 error, retained only as generic OtherError
23408 ms  release-origin dispatcher355 close invocation
23411 ms  socket363 close
23466 ms  beforeExit 0; resource PipeWrap only
23467 ms  process exit 0
```

No notification generation greater than 1 occurred. The two transport IDs must
not be interpreted as proof of a reconnect or runtime-owner replacement.
Content-Type was not collected, so this is an observed notification GET 200,
not a newly observed SSE media-type classification. `OtherError` is intentionally
generic and must not be relabelled AbortError.

The notification fetch records `AbortSignal.any([signal344, signal353]) ->
signal354`. During SDK close, signal344's controller also aborts; during
guarded-release-origin cleanup, signal353's controller aborts. Intermediary
event-listener wiring between SDK signal298 and the guarded timeout signal344
was not directly intercepted, so a complete lexical signal/release chain is not
claimed. `OWNER-ANALYSIS.json` lists all 23 request chains and the relevant events.

## Observer And Invocation Boundaries

The exact `ownership-observer.mjs` and `preload.mjs` used are supplied. They hook
the installed ESM SDK transport and installed Undici Agent classes, forwarding
the same receiver, arguments and return values. No Promise outcome handlers,
new timers, signal replacement, handle destruction, global dispatcher reset,
unref workaround or forced exit were added. Native existing close/destroy calls
are only recorded. Repeated close/destroy invocation logs can result from native
callback/promise overload re-entry, not multiple independently leaked owners.

`guarded-fetch-release` is a fixed enum derived from an in-memory stack frame,
not interception of the entire lexical release closure or its Promise result.
Instrumentation allocates metadata, inspects stacks and writes synchronously;
even passing observed/plain controls do not prove it cannot affect timing.
The stderr prefix/schema filter protects publication privacy but does not
cryptographically isolate the emitter from other code in that process.

Generic invocation shape, **not a request to contact a provider**:

```sh
node --import ./preload.mjs <already-reviewed-read-only-helper.mjs> cheap
```

The actual coordinator first froze helper/core/observer inputs, verified a NAS
backup, checked an idle normal-cycle lease and existing egress gate, retained
the original 170-second supervisor bound, and used an exclusive one-attempt
intent. Its supervisor discarded stdout, accepted only allowlisted metadata,
and would kill/reap only the exact child on timeout. That private host-specific
manifest, account/configuration and runner paths are intentionally not published.
Do not use this observer as a standalone connection check or financial source.

## Remaining Reproducibility Gap

This new run did not hang. A failing credential-free current-main regression
is still not established. The earlier surviving `request17 -> socket17` belongs
to a separate trace: this successful new request ownership cannot identify that
old connection's dispatcher, abort/release owner or generation retrospectively.
No root cause, fix, successful after-fix comparison or repair PR is claimed.

The original 61-file evidence packet is unchanged. Its `authenticated_runs: 0`
describes its earlier fixture/coordinator verification phase, not this later
separately documented one-run authenticated follow-up.
