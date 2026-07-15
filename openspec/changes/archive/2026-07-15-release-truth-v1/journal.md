# Journal: release-truth-v1

<!--
Append-only temporal log, seeded at first apply run, written throughout.
1-3 lines per entry, newest at the BOTTOM. Position, not timestamp, is the
authoritative order. Entry grammar and types per the ooda schema journal
template. SINGLE-WRITER RULE: only the orchestrating agent appends;
subagent proposals are appended attributed `via inc <NN> subagent`.
-->

### 2026-07-14 20:18 · envelope · seed

Journal opens at apply start. Envelope-licensed rows: 01, 02, 03, 04, 05, 06 (all implement decided-now D1–D5; no DEF-blocked lazy rows exist) → any row created later requires a `signal` entry. Subagent capability present; delegate rows dispatch on opus per user instruction.

### 2026-07-14 20:24 · inc 01 · friction

(via inc 01 subagent) Next builds emit a workspace-root warning (multiple lockfiles: parent yarn.lock chosen over animus/bun.lock). Non-fatal noise on every consumer-lane run → a future `outputFileTracingRoot` pin in next-app config would silence it.

### 2026-07-14 20:27 · inc 02 · surprise

First `verify:packed` run: publint --strict FAILS next-plugin (types resolved as CJS under the import condition); manual attw sweep over all five tarballs finds masquerading-as-CJS types (vite-plugin root, next-plugin root+/loader, extract/pipeline), NO types on extract/engine-v2, and node16 internal resolution errors (properties root, system/runtime). All invisible to workspace consumers → the lane's reason to exist, confirmed on first contact.

### 2026-07-14 20:27 · inc 02 · signal

DEF-1 resolving receipt exists: extract tarball is 4.8M carrying BOTH engines' darwin-arm64 binaries (v1 via `*.node` glob, v2 via `crates/extract-v2/*.node`); release CI packs all three platforms per engine → fat main tarball, per-platform optional packages v1-only. Receipt licenses the follow-up distribution-form decision (external:v2-distribution-change-proposal).

### 2026-07-14 20:28 · inc 02 · spawn

Row 07 (publish-manifest-hygiene) spawned to fix the publint/attw harvest — outside inc 02's footprint (packages/* manifests + dts emission). New decision D7 recorded in design.md (supported type-resolution matrix: node16 + bundler; per-format declarations; types on every subpath). Inc 02 blocks on 07 for its green gate.

### 2026-07-14 20:29 · inc 01 · objection

(falsifier, via reviewer subagent) "Consumer lanes run on every push" overclaims: `on.push.branches: [main, next]` means feature-branch pushes never trigger CI at all. Disposition: ACCEPTED as spec-text refinement — delta requirement reworded to "every CI run, jobs unconditional" (trigger-set change stays out of scope). Spec edited by orchestrator.

### 2026-07-14 20:29 · inc 01 · objection

(heretic, via reviewer subagent) Setup-skeleton now triplicated (verify/verify-next/verify-vite), 4x after inc 03 — a matrix job would collapse it. Disposition: REJECTED for this change (matches house style; consolidation is a follow-up candidate, not a blocker).

### 2026-07-14 20:29 · inc 01 · reorientation

- Observe: inc 01 landed clean (both lanes pass locally; ci.yaml +70 lines; release gate untouched; entropy auditor found zero footprint violations). Gate: none in scope. No [~] deferrals.
- Orient: outcome matches D1's lanes-half prediction. NS2 partially satisfied (lanes exist, gate flip pending inc 03); NS3 untouched. Lazy rows: none. Stances run: full pass (falsifier · entropy auditor · heretic) — first landing after envelope. Objections: 2 (see above; 1 accepted spec reword, 1 rejected note).
- Decide: continue. Inc 03 remains blocked on 02 (now transitively on 07). Spec reword applied; matrix consolidation noted as post-change candidate.
- Act: spec delta reworded (release-workflow "every CI run"); registry row 01 ticked; row 07 added (spawn above).

### 2026-07-14 21:20 · inc 07 · surprise

(via inc 07 subagent) `attw --profile node16` structurally cannot pass for any pure-ESM package (node16-from-CJS always blocks with CJSResolvesToESM); green demands CJS-only or dual-with-`.d.cts`. The packet's "mirror system (ESM)" suggestion assumed system root was node16-green — it wasn't.

### 2026-07-14 21:20 · inc 07 · surprise

(via inc 07 subagent) properties + system share one root cause out of this change's reach: `moduleResolution: "bundler"` makes tsgo emit EXTENSIONLESS relative specifiers in every `.d.ts`; node16-ESM rejects those (and directory imports). Runtime files carry `.js` extensions — pure types-vs-runtime skew. Real fix = declaration-emit toolchain change → DEF-5.

### 2026-07-14 21:20 · inc 07 · friction

(via inc 07 subagent) The canary gate caught two couplings invisible to publint/attw: `canary.test.ts` requires `dist/index.mjs` by path (forced pipeline dual esm+cjs), and a CJS properties build broke rquickjs `loadSystemModule` ("exports is not defined") — properties is consumer-pinned to ESM by the Rust system-loader.

### 2026-07-14 21:20 · inc 07 · friction

(via inc 07 subagent) Hand-written `index-v2.js` (`module.exports = loadNative()`) is opaque to cjs-module-lexer, so honest napi named-export types trip attw "Named exports"; the green shim is an `export =` opaque value with type-only members.

### 2026-07-14 21:22 · inc 02 · surprise

Inc 07's "properties + system pass esm-only today" claim did not hold in the lane: esm-only still checks node16-from-ESM, where the DEF-5 defect blocks. Disposition: explicit narrow allowlist (`--ignore-rules internal-resolution-error`, those two packages only, bundler must stay green) with removal tied to DEF-5; D7 text updated.

### 2026-07-14 21:25 · inc 02 · friction

Three template/lane fixes to reach green: (1) `borderRadius: 4` fails stable tsc in the packed theme — the fixture only accepted it via test-ds's includes (radii scale); changed to `'4px'`. (2) Staging tsc leaked parent `@types` (bun-types) via automatic inclusion walking up node_modules — `"types": []` makes the consumer hermetic. (3) Next 15's build-time type-check cannot lib-check its own template dts — template tsconfig gets `skipLibCheck: true` while the lane pins `--skipLibCheck false` on its own stage-6 tsc. Also: attw `--ignore-rules` is variadic — positional tarball arg must precede it.

### 2026-07-14 21:26 · inc 02 · signal

Packed-lane receipt now exists end-to-end (publint 5/5, attw 5/5 under D7-revised profiles, isolated npm install, dual-engine load, stable-TS declarations, Vite+Next builds, positional assertions). DEF-1's tarball-contents receipt is durable: extract tarball ships both engines' binaries (4.8M, darwin-arm64 local run).

### 2026-07-14 21:40 · inc 02+07 · objection

(falsifier F1, via reviewer subagent) Registry platform packages (`@animus-ui/extract-darwin-arm64` et al) leak into staging via optionalDependencies, outside overrides and outside the version loop — isolation clause failed black-box. ACCEPTED. First fix (`--omit=optional`) broke lightningcss (third-party natives ship as optionals); final fix: keep optionals, defense-in-depth check pins allowed `@animus-ui/*` to the five packed names plus exactly the optionals DECLARED by the packed extract manifest; spec clause rewritten accordingly.

### 2026-07-14 21:40 · inc 02+07 · objection

(falsifier F2, via reviewer subagent) Engine-binary-missing scenario was untested, and the v1 napi loader silently falls back to the registry platform package. ACCEPTED: fault-injection proof run in staging — with local `.node` AND platform package removed, v1 throws (napi aggregate error), v2 throws its actionable platform-named error; both restored and reload. Recorded in packet 02. v2 invocation is empirically covered by the builds (default engine); v1 stays load-proof-only per NS5.

### 2026-07-14 21:40 · inc 02+07 · objection

(falsifier F3, via reviewer subagent) Receipt `engineLoaded: 'v2'` was a hardcoded literal — asserted, not measured. ACCEPTED: receipt step now derives override from the staged consumer configs and default from the INSTALLED packed plugin code, failing loud if undeterminable; a future default flip changes receipts without script edits. Receipts now print measured values.

### 2026-07-14 21:40 · inc 02+07 · objection

(falsifier F4, via reviewer subagent) DEF-5 allowlist (`--ignore-rules internal-resolution-error`) is blanket per-package, so a NEW internal-resolution regression in properties/system would be masked. NOTE-ONLY (attw has no per-path scoping); blast radius acknowledged in D7 text; bundler mode still gates both packages.

### 2026-07-14 21:40 · inc 02+07 · objection

(entropy auditor E2, via reviewer subagent) Spec "Type resolution violation detected" overclaimed node16 gating for the allowlisted packages. ACCEPTED: requirement reworded to per-package supported modes with a scoped-exemption clause + regression scenario; leakage lints re-run clean. E3 (wrong "properties is CJS" comment in _preconditions.sh) also ACCEPTED and fixed. E1: zero footprint objections.

### 2026-07-14 21:40 · inc 02+07 · objection

(heretic H2, via reviewer subagent) ESM→CJS-only conversion of the plugins is tail-wagging-dog — attw's node16-from-CJS mode demands a consumer that barely exists for a Vite plugin; asymmetric with the profile relaxation properties/system received. REJECTED for this change: next-plugin's webpack loader is genuinely CJS, the conversion also fixed the publint types-flavor error, and all lanes are green — but the objection is preserved as a candidate to revisit when DEF-5's toolchain fix enables proper ESM+dual-dts (H1 overrides-realism and H3 fixture-drift noted alongside).

### 2026-07-14 21:41 · inc 02+07 · reorientation

- Observe: inc 07 landed 3/5 attw-green + 2 DEF-5-blocked; inc 02 lane green end-to-end after three template/lane fixes; full three-stance review returned 4 accepted objections (F1, F2, F3, E2+E3) — all fixed and re-proven (lane re-run exit 0, measured receipts, fault-injection proof) — and 5 notes/rejections dispositioned above. Gates: G2 pass, G4 pass (exit 1, exact fail-loud message, no rebuild).
- Orient: outcome vs Ledger — DEF-1 signal recorded (fat tarball receipt); DEF-5 added mid-flight (new deferral, correctly signal-gated); D7 revised once on falsification, per-package profiles now honest. NS1/NS3 strengthened (claims now measured); NS4 unchanged (single-runner proof); NS5 upheld (v1 load-only, semantics stay in parity). Lazy rows: none pending; DEF review-by dates all distant. Stances: full pass (reviewer subagent); objections: 9 total, dispositions written.
- Decide: continue. Next wave: 04 (peer clamps — manifests now free), then 03 (gate flip), then 05 + 06. H2 revisit rides DEF-5. No re-plans, no spawns beyond 07 (already landed).
- Act: registry rows 02 and 07 ticked; packet 02 addendum written; spec + script fixes applied above.

### 2026-07-14 21:50 · inc 04 · friction

(via inc 04 subagent) Step-3's primary `bun -e` semver probe exits 0 but swallows stdout in this harness — proof by exit code, not print; the `bunx semver@7` fallback gave the visible accept/reject evidence. Also: delegate dispatch for row 04 misfired once (returned boilerplate, zero tool calls, 11s) — re-dispatched clean; watch for one-shot subagent misfires.

### 2026-07-14 21:50 · inc 04 · surprise

(via inc 04 subagent) The packed next build logs `[animus-extract] Transform failed for .animus/system-props.js: path not present in the last analyze() call` yet compiles and passes all assertions. Pre-existing, not peer-clamp fallout — flagged out-of-change for investigation (spawn chip filed).

### 2026-07-14 21:55 · inc 04+05 · objection

(falsifier, via reviewer subagent) peer-range-policy scenarios said "the package manager reports a peer-range conflict" — true for npm, false for bun (bun tolerates peer mismatches), and bun is the repo's primary PM. ACCEPTED: scenarios reworded to "peer-enforcing package manager" with the packed lane's npm install named as the reference enforcer. Ranges themselves verified correct (prerelease rejection included).

### 2026-07-14 21:55 · inc 04+05 · objection

(falsifier + heretic, via reviewer subagent) Change-Type Map glob `packages/*/package.json` over-matched non-publishables; `webpack: ">=5.0.0"` escaped the upper-bound rule via G3's regex and an undefined "host framework" term. BOTH ACCEPTED: map row scoped to the five publishables; webpack clamped `>=5 <6` (fixtures prove webpack 5 only, vendored by Next 15); spec now defines host framework (vite/next/webpack); G3 regex extended to webpack and recalibrated (empty — passes).

### 2026-07-14 21:55 · inc 04+05 · objection

(entropy auditor, via reviewer subagent) CLAUDE.md's verify:ci row claims "packed lane mirroring its CI job" but ci.yaml has no packed job yet — inc 05 forward-referenced inc 03. ACCEPTED with disposition: resolved by sequencing — inc 03 lands next and its gate (G1) verifies the claim becomes true; if 03 were abandoned the row would need softening. Also noted: no git-level per-increment isolation exists (whole change is uncommitted) — inherent to the schema's no-VCS rule, not entropy.

### 2026-07-14 21:56 · inc 04+05 · reorientation

- Observe: 04 landed clean (clamps + all six steps green incl. packed npm strict install), 05 landed clean (G5: 4 hits; composite prose matches vite.config.ts dependsOn). Reviewer returned 3 accepted objections (all fixed above: PM wording, glob scope + webpack clamp + host-framework definition, forward-reference disposition) and 4 notes. One delegate misfire (04 first dispatch) — no work lost.
- Orient: outcome vs Ledger — DEF-2 untouched (React peers intentionally out of scope); no new deferrals. NS3 strengthened (all three host peers now evidence-bounded); NS1 hinges on inc 03 closing the verify:ci forward-reference. Lazy rows: none. Stances: full pass (falsifier · entropy auditor · heretic via reviewer subagent) — triggered by surprise entries since the 02+07 pass. Objections: 7 (3 accepted, 4 note-only), dispositions written.
- Decide: continue. Land 06 (running), then 03 last; 03's gate additionally verifies the verify:ci row's claim. Webpack clamp rides under the packed lane's npm proof at 03's step 1.
- Act: registry rows 04 and 05 ticked; G3/G5 register rows flipped to active with recalibration; CHANGELOG Unreleased section written (cross-cutting 2.1 ticked).

### 2026-07-14 22:00 · inc 06 · friction

(via inc 06 subagent) Footprint drift: the showcase assert script lives at repo-root `scripts/assert-showcase-build.ts`, not `packages/showcase/scripts/**` as the registry row assumed — packet's locate-directive resolved it; registry row corrected. Also: `verify:lint` was red on CLAUDE.md + e2e/packed-app/package.json (format drift from incs 05/02) — orchestrator ran `vp fmt`, lint green again before the gate flip.

### 2026-07-14 22:00 · inc 06 · surprise

(via inc 06 subagent) hostVersion must come from the fixture's own node_modules (all three fixtures keep hosts local, not root-hoisted) — the manifest range would produce wrong strings. Receipts proven with an ANIMUS_ENGINE=v1 flip (engineLoaded→v1, engineOverride→true, default stays v2).

### 2026-07-14 22:05 · inc 03 · friction

(via inc 03 subagent) The packed lane is the slowest inner-loop tier (~4 min: npm staging install + Next prod build); in CI it parallelizes off build-extract so wall-clock hides it. Step 1 doubled as the live npm-ERESOLVE proof of all three clamped peers (vite/next/webpack) — no conflict.

### 2026-07-14 22:10 · inc 03+06 · objection

(falsifier, via reviewer subagent) `engineLoaded`'s non-override branch was a literal `'v2'` in all three assert scripts — a consumer-config default flip would produce a lying receipt ("MEASURED" comment was false). ACCEPTED: scripts now capture BOTH arms of the config's engine expression and use the config fallback for the non-override branch; re-proven standalone on all three lanes + env flip + restore. Build-time-vs-assert-time skew window (standalone assert against stale build) noted as note-only — real but requires split invocation.

### 2026-07-14 22:10 · inc 03+06 · objection

(heretic, via reviewer subagent) Receipts were written into gitignored dirs and never uploaded in CI — write-and-discard. ACCEPTED: `actions/upload-artifact` steps added to all four lane jobs (receipts-showcase/-next/-vite/-packed); YAML re-validated. Entropy auditor: leakage lints clean; CLAUDE.md verify:ci forward-reference now TRUE (verify-packed job exists); the extract/tsdown "outside allowlist" flag was a reviewer misread — those files are inc 07's declared footprint. Release-gate falsifier: zero objections (all six job ids exist; verify-packed skeleton matches known-green verify-next; test-rust transitively gates via verify).

### 2026-07-14 22:13 · inc 03+06 · reorientation

- Observe: inc 06 landed (receipt helper + three lanes + unit test + env-flip proof; 219 tests green), inc 03 landed (verify-packed CI job + release.needs = six ids; G1 PASS with recorded output). Final full-stance review returned 2 accepted objections (engineLoaded literal, receipts not uploaded) — both fixed and re-proven (three standalone assert runs + flip/restore + yaml-lint + verify:lint exit 0) — and several notes. All seven registry rows + cross-cutting 2.1 now complete.
- Orient: outcome vs Ledger — D1–D7 all implemented; DEF-1 (signal recorded), DEF-2/3/4/5 remain deferred with owners and dates. NS1: contract tables, receipts, and gates now agree with shipped reality (the verify:ci forward-reference closed). NS2: release gate is the full superset — G1 active and passing. NS3: all host peers evidence-bounded. NS4: single-runner proof stands (provisional). NS5: held throughout. Stances: full pass (G1 STOP-closure + K=3 both landed here). Objections: 2 accepted (fixed), rest notes.
- Decide: change complete — proceed to verify artifact (independent verifier), then retrospective. Archive will be POSTPONED: implementation is uncommitted working-tree state on feat/random and this schema performs no VCS actions; conformance check cannot pass until the branch lands on main.
- Act: registry rows 03 and 06 ticked; receipt scripts + ci.yaml upload steps applied above; G1 register row flips to active.
