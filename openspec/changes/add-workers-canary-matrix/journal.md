# Journal: add-workers-canary-matrix

<!--
Append-only temporal log. The first entry is added at apply start and records
the envelope-licensed registry rows. New entries always go at the bottom.
-->

### 2026-07-14 01:29 EDT · envelope · seed

Journal opens at apply start. Envelope-licensed row: 01; rows 02–06 remain
lazy behind DEF signals/inputs; 2.1 remains ops-gated. First work is the
dependency and runtime envelope.

### 2026-07-14 01:33 EDT · signal · implementer

DEF-1 resolved by an exact locked Node/Wrangler/Cloudflare/Vite/Vinext/React/
React Router dependency graph. The focused manifest contract, frozen install,
and full CI mirror passed; rows 02–04 are eligible for packet materialization.

### 2026-07-14 01:33 EDT · surprise · implementer

Bun's initial resolver warned on the coordinated Vinext beta pair because
`@vinext/cloudflare@1.0.0-beta.1` publishes `vinext >=0.0.0`, a range that does
not opt into prereleases. `bun pm why vinext` confirms the exact adapter peer is
resolved and the frozen install is clean. D9 accepts the metadata exception;
row 04's production build supplies runtime proof.

### 2026-07-14 01:39 EDT · review · lower_severity_reviewer

Initial increment review rejected the range-prefix-only pin assertion and an
over-broad proposal to materialize row 05. The test was strengthened to exact
SemVer plus the complete D9 map and negative selector cases; row 05 remains
lazy behind row 04.

### 2026-07-14 01:40 EDT · review · lower_severity_reviewer

Clean re-review accepted increment 01. Exact pins/types, the row 02–04 signal,
and the explicit Vinext metadata exception are all correctly represented.

### 2026-07-14 01:40 EDT · reorientation · full

North Star and objective remain unchanged. No new spec authorship is owed.
Existing modes and footprints remain appropriate. Materialize rows 02–04 from
D9; retain row 05 until row 04 supplies Vinext production evidence and retain
row 06 until DEF-2 resolves. Guardrails G1–G5 remain active and clean. The only
newly explicit residual risk is upstream Vinext prerelease peer metadata, owned
by row 04's build proof.

### 2026-07-14 01:52 EDT · signal · workers_inc02_implementer

Showcase Worker `animus` is locally reproducible as an assets-only SPA: focused
build/assert, app-owned config, 37-asset deployment dry run, and G1–G5 pass.
Wrangler required sandbox permission only for its standard macOS debug-log path;
no repository workaround was added.

### 2026-07-14 01:55 EDT · review · lower_severity_reviewer

Initial row-02 review rejected chunk-existence as insufficient evidence for the
`/docs/start` fallback. The row remained open pending an actual local Worker
request.

### 2026-07-14 01:58 EDT · review · lower_severity_reviewer

Clean re-review accepted row 02 after local Wrangler returned `200 text/html`
for `/docs/start`, logged the `not_found_handling` navigation path, and served
the Animus entry-document/layer markers.

### 2026-07-14 01:58 EDT · reorientation · full

No objective or North Star drift. D1, the showcase leg of D2, the static-assets
leg of D3, and the showcase proof in D7 are implemented. No new decision,
deferral, unknown, spec authorship, mode, or footprint change is owed. Rows 03
and 04 remain next; row 05 remains gated on 04, row 06 on DEF-2, and 2.1 on the
complete local matrix.

### 2026-07-14 02:03 EDT · signal · workers_inc03_implementer

Vite Worker `animus-vite-canary` is locally reproducible: behavioral Worker
RED/GREEN, Cloudflare Worker+client build, unchanged extraction assertions,
generated deployment config, five-asset dry run, `/api/health` workerd response,
and G1–G5 pass. The known `StackItem` pruning warning repeats once per
environment without state collision, drift, or missing styles.

### 2026-07-14 02:05 EDT · review · lower_severity_reviewer

Initial row-03 review accepted the API/Worker leg but rejected it as incomplete
because the integrated SPA fallback had not been requested through the generated
Worker config.

### 2026-07-14 02:09 EDT · review · lower_severity_reviewer

Clean re-review accepted row 03 after `/canary-route` returned `200 text/html`
with Vite/Animus entry markers and Wrangler confirmed navigation used
`not_found_handling`.

### 2026-07-14 02:09 EDT · reorientation · full

No objective or North Star drift. The full-stack Vite legs of D3 and D4 are
implemented without weakening the prior extraction oracle. Repeated pruning is
benign per-environment diagnostic duplication, not a DEF-2 signal. No new
decision, unknown, mode, footprint, or spec authorship is owed. Row 04 is next;
row 05 remains gated on 04, row 06 on DEF-2/all inputs, and 2.1 on the complete
local matrix.

### 2026-07-14 02:22 EDT · signal · root

Vinext's coordinated beta accepted the self-contained hybrid surface: App RSC,
client boundary, and Pages Router all built, asserted, dry-ran, and returned 200
through local workerd with extracted Animus classes. React 19 hydration advanced
the client intent and count without navigation. DEF-3 resolves positively to D10,
and D9's prerelease peer-metadata exception is functionally proven.

### 2026-07-14 02:22 EDT · surprise · root

The Vinext beta emits an identical hashed CSS filename twice and reports partial
App Router `reactStrictMode` support. Complete CSS and route/runtime evidence show
neither is an Animus multi-environment failure. The in-app browser bridge also
failed in its own process-shim bootstrap; review accepted a React 19
`hydrateRoot` interaction test combined with production client output and live
workerd delivery.

### 2026-07-14 02:23 EDT · review · lower_severity_reviewer

Initial row-04 review rejected SSR-only `/client` evidence because it did not
exercise hydration. The row remained open pending an interaction state change.

### 2026-07-14 02:24 EDT · review · lower_severity_reviewer

Clean re-review accepted row 04 after the actual client component hydrated,
changed intent/count on click, and retained its URL. Fixture-root React dedupe
uses Vite's supported `resolve.dedupe` mechanism and adds no React alias.

### 2026-07-14 02:24 EDT · reorientation · full

No objective or North Star drift. D10 records the accepted hybrid Vinext surface;
DEF-3 is resolved, and no Vinext-side DEF-2 signal appeared. Materialize row 05
to add the independent React Router v8 SSR environment and make the final DEF-2
decision. Row 06 and ops 2.1 remain gated on that result and the complete local
matrix. No new spec authorship, guardrail, mode, or footprint change is owed.

### 2026-07-14 02:36 EDT · signal · root

React Router v8 built its client and Cloudflare `ssr` environments with one
unmodified Animus plugin instance. Client and server emitted the same 8.56 kB
stylesheet content; artifact assertions, hydration, deployment dry run, exact
health response, and live SSR/client routes all passed. The Vinext regression
build remains green.

### 2026-07-14 02:36 EDT · surprise · root

React Router typegen produced the correct virtual server-build declaration, but
the initial fixture `tsconfig` did not include `.react-router/types/**/*`.
Including the framework-owned generated types resolved typecheck without any
runtime or library change.

### 2026-07-14 02:37 EDT · review · lower_severity_reviewer

Clean review accepted row 05 and independently confirmed 20 focused tests, the
97-module client build, 92-module SSR build, identical stylesheet output, and
2-CSS/12-JavaScript assertions. DEF-2 resolves to no adaptation.

### 2026-07-14 02:37 EDT · reorientation · full

No objective or North Star drift. D11 records that Animus's current per-instance
Vite lifecycle is sufficient; DEF-2 is resolved without library code changes.
Materialize delegated row 06 for centralized tasks, ownership rows, generated
artifact ignores, Netlify removal, and the complete local verification matrix.
Ops 2.1 remains gated on row 06. No new spec authorship, guardrail, mode, or
footprint change is owed.

### 2026-07-14 03:05 EDT · signal · workers_cutover_implementer

The checked-in cutover now exposes four independent production builds and root
deploy commands, atomic Vinext/React Router assertions, four credential-free
Worker dry runs, and permanent fixture contracts. Netlify configuration is
removed. Focused builds/assertions, native Next, all dry runs, `verify:full`, and
the 26-task CI mirror pass.

### 2026-07-14 03:07 EDT · review · lower_severity_reviewer

Initial row-06 review rejected four details: public atomics depended on builds,
`verify:full` omitted Worker contracts, Worker identity used source-text grep,
and ownership missed new assertion/Vite surfaces. Row 06 remained open for
correction 06.R1.

### 2026-07-14 03:11 EDT · review · lower_severity_reviewer

Clean re-review accepted correction 06.R1 after public atomics lost build
dependencies, focused/private chains preserved ordering, full gained Worker
contracts, Wrangler's JSONC parser became the identity authority, and shared
ownership rows covered every new consumer. Independent correction contracts and
the missing-output fail-loud proof passed.

### 2026-07-14 03:11 EDT · reorientation · full

No objective or North Star drift. D1, D2, D6, and D7 are implemented locally;
all six implementation increments are accepted and Netlify is no longer an
active path. Cross-cutting gate 2.1 is now unblocked: authenticate the intended
Cloudflare account, update `animus`, create the three named canary Workers,
configure their Git-connected Workers Builds settings, and smoke each deployed
runtime. DEF-4 remains deferred until those external observations exist. No new
spec authorship, decision, guardrail, or implementation increment is owed.

### 2026-07-14 03:14 EDT · signal · root

The ops preflight is blocked on Cloudflare authentication: Wrangler reports no
authenticated user and the dashboard session redirects to sign-in. Read-only
public smokes confirm the previous `animus` deployment remains healthy at root
and `/docs/start`, while all three new canary hostnames return 404. No remote
mutation was attempted; cross-cutting gate 2.1 and DEF-4 remain open pending a
user-authenticated account session.

### 2026-07-14 11:50 EDT · signal · root

Wrangler OAuth authenticated the intended account and deployed all four targets
at 100% traffic. Production smokes passed for showcase root/deep SPA routes,
Vite SPA/API routing, Vinext App/client/Pages routes, and React Router
SSR/client/health routes; framework responses contain extracted `animus-*`
classes. The three new Worker services now exist independently.

### 2026-07-14 11:50 EDT · surprise · root

The in-app dashboard browser remains signed out, and Wrangler's OAuth token does
not carry the distinct Workers Builds Configuration permission: the official
Builds API rejects build-token access with authentication error 10000. Worker
script deployment is complete, but Git connections, root build commands, and
non-production branch triggers remain open until dashboard sign-in or a scoped
user API token is available.

### 2026-07-14 11:50 EDT · reorientation · full

Runtime deployment has achieved the four-Worker topology and every remote smoke
signal, but cross-cutting gate 2.1 and DEF-4 remain open because their explicit
Git-connected build condition is not yet observed. No implementation change is
owed. The next action is external authentication with Workers Builds
Configuration Edit, followed by applying the checked-in runbook settings and a
Git-triggered build after the repository changes reach `main`.
