# Increment 13: flip-preconditions

## Scope

- **Registry row**: 13 · mode: inline · review: subagent
- **Resolves**: DEF-7 (watch/incremental architecture — expected to
  resolve AGAINST a v2 cache for the flip: baselines put the whole v1
  pipeline at ~50ms for the 62-file showcase and v2 at 1× parses/file
  vs v1's 8×, so uncached re-analysis is within dev-loop budget;
  row 08 then closes as subsumed or narrows to a post-flip
  optimization)
- **Authors**: — (envelope specs cover behavior; this row is plumbing +
  proof)
- **Depends on (ordering — deps:)**: 07
- **Inputs from (information — inputs:)**: 07 (scoreboard, register,
  input-gap journal entries)
- **Footprint**: v2 crate, index-v2.js, vite-plugin, next-plugin,
  _parity, scripts/verify, this change dir

## Context Capsule

- **Objective**: make `engine: 'v2'` a REAL option end-to-end — the
  plugins feed the v2 engine everything they feed v1, and the consumer
  builds (showcase, next-app, vite-app) become the oracle. Row 07
  proved the spine on a 37-unit corpus; this row proves the plumbing on
  real applications (the heretic's point, journal 09:05).
- **Known engine input gaps** (journal 07:55, 10:20): globalStyleBlocks,
  keyframes blocks, packageResolution, pathAliases. selectorOrder is
  dead in v1's engine (register: v1-feature-drift) — do NOT add it.
  selector_aliases/theme/config/groupRegistry/variableMap/contextualVars
  already exist as EngineOptions.
- **Plugin wiring**: vite-plugin/next-plugin currently construct
  `requireEngine(engine)` and call the v1 function API; the v2 leg must
  construct `ExtractEngine` from loadSystemModule output (which stays a
  v1 NAPI call — porting loadSystemModule is NOT this row unless the
  builds prove otherwise). Dev-mode: plugins re-call analyze on change;
  v2 re-analyzes uncached (DEF-7 material — measure it).
- **Task order**:
  1. Engine inputs: globalStyleBlocksJson + keyframesJson (feed
     resolve_all_global_blocks/keyframes port — v1 project_analyzer
     1708-1736), packageResolutionJson + pathAliasesJson (provenance
     resolution for package-specifier/aliased parents — closes the
     journaled F3 residue).
  2. Plugin v2 leg: construct ExtractEngine from loadSystemModule
     config; route analyze/transform through the handle; dev + prod.
  3. Consumer-build oracle: verify:showcase / verify:next / verify:vite
     green with engine v2; assert-tier positional assertions unchanged.
  4. Dev-loop measurement: analyze() wall-clock per HMR change at
     showcase scale; resolve DEF-7 with numbers.
  5. Corpus gaps from the 07 review while the oracle is hot: re-export
     extension parent, multi-component custom props, duplicate compose,
     one-arg compound (F1 witness), props-serde-reject (F4 witness),
     compose-only file (F5 witness), EOF-consumed-import corners (F7
     witness) — each as a corpus unit or fixture, differential green.
- **Prohibitions**: standard (no VCS mutations; footprint;
  single-writer). External evidence gate (untracked tree) is USER
  material — do not wait on it for row work, but row 12 stays blocked.

## Plan

## Task 13.1: Engine input completion
- [x] TWO-PASS FACTS (journal 10:50): pass A statics/exports/imports
      over the live AstStore, binding-resolved static enrichment
      (imported consts + keyframes registry), pass B chain facts with
      enriched statics — no re-parse (G1). globalStyleBlocksJson/
      keyframesJson inputs + global sheet wiring; packageResolution/
      pathAliases provenance inputs (v1 resolve_path order: relative →
      alias → package map); imported-static + keyframes corpus units
      (falsifiers for the pre-13 green); parity harness passes new
      inputs symmetrically. LANDED — journal 11:30: two-pass facts,
      4 new inputs, v1-exact resolve order, imported-static +
      keyframes-import corpus units, symmetric harness feeding; 39
      units 0-unregistered both modes; 277 crate tests.
## Task 13.2: Plugin v2 leg
- [x] vite-plugin: engineApi() adapter at the choke-point, per-plugin-
      instance ExtractEngine (DEF-1), loadSystemModule stays v1; NAPI
      null-vs-undefined footgun found by the first real build and fixed
      across every JS adapter (journal 12:55). next-plugin leg DEFERRED
      with the next oracle (below).
## Task 13.3: Consumer-build oracle
- [x] vite-app AND showcase: BYTE-IDENTICAL dist on engine v2 (diff
      clean incl. CSS assets); assert-vite + assert-showcase pass on
      v2-built output; fixtures select engine via ANIMUS_ENGINE.
      next-app leg BLOCKED EXTERNALLY: pre-existing verify:next
      breakage (typescript pkg removed in tsgo migration — user task
      chip) + next-plugin v2 leg rides with it as a follow-up row.
## Task 13.4: DEF-7 resolution
- [x] Showcase scale, dev mode: v1 warm-cache re-analyze 10.7ms; v2
      UNCACHED re-analyze 9.8ms. DEF-7 resolved: no incremental cache
      ships; row 08 retired (journal 13:30).
## Task 13.5: Review-witness corpus units
- [x] F1/F4/F5/F7 witnesses LANDED (43 units, 0 unregistered, both
      modes — journal 13:55). re-export/multi-custom/duplicate-compose
      deferred to the follow-up row: each activates a registered
      divergence needing implement-or-flip intent.

## Guardrail gate
- [ ] G1-G9 per Register; 5-leg verify:parity; consumer builds.

## Output contract (inline mode)
- [ ] Plan ticked; gates recorded; DEF-7 resolution recorded; journal;
      flip-decision material for the envelope (v1 default → v2 default
      is a SEPARATE, user-gated decision).
