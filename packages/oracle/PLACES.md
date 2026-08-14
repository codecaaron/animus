# Animus Many-Place Analysis

**Working name:** the `places` layer of `@animus-ui/oracle` — an optional sidecar
that moves between real source locations, declared contexts, rendered
observations, and proposed changes.

**One-sentence definition:** given a real invocation in real source, identify the
materially different places that matter, explain their outcomes, and distinguish
what a proposed change alters, keeps stable, leaves ambiguous, or cannot reach.

It is **not** an oracle, a browser replacement, or a React simulator. The render
oracle (DESIGN.md) answers questions at coordinates it is handed; the four-persona
cold review of 2026-08-12 found its entry vector inverted — every real workflow
starts at a file, a symptom, or a diff, not at a `(component, variant, mode)`
tuple. This layer is that entry: it carries knowledge across multiple
perspectives while remaining explicit about where its knowledge ends.

The commitment is to the product question and the honesty boundary, not to a
final implementation architecture.

---

## 1. Canonical semantic seams (what is reused, never reimplemented)

The sidecar must reuse Animus extraction, resolution, and emitted CSS — one
trusted semantic boundary. Anything else drifts. The seams, in decreasing
authority:

| #   | Seam                                    | Source of truth                                                                                                                                                         | What it answers                                                                                                             | What it cannot answer                                                                                                 |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| S1  | **Artifact set**                        | `.animus/{manifest.json, styles.css, commit.json}` via `host/animus/loader.ts`                                                                                          | the complete style universe: every rule, layer, condition, provenance join                                                  | anything about a build it didn't come from                                                                            |
| S2  | **Cascade**                             | `engines/cascade.ts` + `host-layer-parity` tether to extract's `ANIMUS_LAYERS`                                                                                          | winners, defeats, layer/specificity/order, `!important` reversal                                                            | tree-position matching (S4's job)                                                                                     |
| S3  | **Resolution replay**                   | `components[id].replacement` → `TargetResolution.classes(point)` (`host/animus/identity.ts`)                                                                            | which classes an element carries at a scenario point — the compile-time replay of `resolveClasses`                          | which _invocation_ carries them                                                                                       |
| S4  | **Invocation facts**                    | `fileFacts[file].usage` (`UsageFact::Element`: tag + `AttrFact` static/enumerable/dynamic classification + `variantClass`), `usageResidue` spans, `fileFacts[].imports` | which components a file invokes, with which statically-known prop bindings                                                  | _where_ in the file (static elements carry no span) and _under what ancestors_ (usage is a flat, source-ordered list) |
| S5  | **Structure read** (new, sidecar-owned) | fresh parse of the authored file with the repo-pinned `oxc-parser`                                                                                                      | JSX tree with spans: ancestor chains, static `className`/`data-*` attrs, component boundaries, spreads, expression children | anything behind a component boundary, a spread, or a dynamic attribute — those are opaque, by construction            |

S5 is deliberately the weakest authority and the only new reader. It reads
_structure_, not styling semantics: it never interprets a style, a token, or a
class name — it only says "this JSX element sits under these ancestors, and
these ancestor facts are static." Every styling conclusion still flows through
S1–S3.

### The correspondence guard (mixed-generation prevention)

S4 and S5 describe the same file from two generations: the manifest records what
the _extracted_ source contained; the fresh parse reads what the _working tree_
contains now. Before any answer is issued for a file, the sidecar projects the
fresh parse onto the manifest's usage sequence (component-like tags with their
static attr classifications, in source order). Agreement is a per-file
correspondence witness and is recorded as such. Disagreement means the file has
drifted since the build — the sidecar **refuses** with the divergence, rather
than mixing facts from two generations of the program. This is the concrete
mechanism behind "prevent mixed-generation snapshots": correspondence is
checked, not assumed.

### Tag attribution (never an arbitrary winner)

A JSX tag attributes to a component through S4's import facts. A bare binding
that matches two components never resolves to an arbitrary winner: a relative
import specifier names one file, so the path decides what the binding cannot,
and anything still ambiguous is surfaced through `unresolved(file)` with its
candidate ids — an addressable gap, not a silent drop. Tags outside the
universe stay unlisted: a plain wrapper is an opaque boundary, not a failed
attribution.

## 2. The model

```text
Snapshot   = artifact set (S1) + generation identity (commit.json content
             hashes / program.hash) + the oracle host built over it.
Invocation = (snapshot, file, element ordinal + span, component id,
             static bindings, dynamic bindings → obligations).
Place      = invocation + structural context: for every ancestor-sensitive
             axis the universe declares relevant, one of
             established / refuted / open(reason).
Context    = a cell of the scenario domain restricted to a place — only the
             axes that materially affect the question partition it.
Outcome    = per place × context, one of changed / stable / ambiguous /
             inaccessible (for a carried change), each with derivations.
```

- Component-plus-variant cannot identify the actual invocation, possible
  runtime family, structural context, or program generation being discussed;
  `Place` can.
- "Materially different" is computed, not enumerated: two contexts merge when
  the question's fact derivation (winner chain for the queried properties) is
  identical in both. The partition only splits where outcomes split.
- Observations (classes, DOM, SSR, later browser measurements) narrow
  possibilities or discharge particular unknowns; they never manufacture
  certainty. An observation that contradicts the model is surfaced, not
  averaged in.

## 3. Ancestor axes — relational selectors become decidable per place

Today the universe classifies any combinator selector as `relational`, carries
it as a cascade rule whose ancestor part is **not** a guard, and discloses the
gap as one `tree-shape` exclusion. The cold review confirmed the consequence
(bug h): `[data-color-mode=dark] .X` wins at `mode=light` with static-proof
authority.

The fix and the sidecar's entry point are the same mechanism, following the
existing `pseudo:<name>` convention (`engines/cascade.ts` §guard):

- `analyzeSelector` splits a relational selector into its **subject compound**
  (the trailing compound, where the component class lives) and its **ancestor
  prefix** (everything before it, combinators preserved).
- An ancestor compound of exactly `[data-color-mode=<m>]` becomes the guard
  conjunct `mode = <m>` — the same axis the token channel already owns
  (`ROOT_MODE`), because that attribute is the mode selector's root encoding.
- Every other ancestor prefix becomes the conjunct
  `ancestor:<normalized prefix> = true` (e.g. `ancestor:[data-active=true]`,
  `ancestor:.group:hover`). Hosts do not declare these axes globally, so in a
  bare world the rule is _conditional_ (the existing unbound-axis machinery),
  never silently active — strictly more honest than today.
- A **place** binds them: static structure establishes
  `ancestor:[data-active=true]` (wrapper carries `data-active="true"`), refutes
  it (`data-active="false"`, or no such ancestor anywhere and no opaque
  boundary), or leaves it open with the reason (opaque component between,
  spread attrs, dynamic value) — an addressable obligation, not a guess.
  A prefix containing a stateful pseudo-class (`.group:hover`) can at most be
  refuted structurally (no `.group` ancestor); its hover half stays a state
  axis. Place worlds are ordinary `pinDomain` worlds — every oracle operation,
  verdict channel, and fixpoint rule applies unchanged.

## 4. The first validation (acceptance)

The active, dark-mode `GroupItem` producing gray text on blue, from its real
source invocation:

The kit's `GroupItem` (`packages/test-ds/src/components/GroupItem.tsx`) declares
`color: text` base, `'[data-active="true"] &'` → `color: background` on
`bg: primary`, and `_dark` → `color: text.muted`. In the emitted sheet the
active rule and the dark rule share layer `anm-base` and specificity (0,2,0);
the dark rule is emitted later, so at active ∧ dark it wins `color` by order
while the active rule keeps `background-color: primary` — gray on blue.

Starting from a real invocation of `GroupItem` under a
`<div className="group" data-active="true">` wrapper, the sidecar must:

1. resolve file+offset → the invocation and its places (correspondence-checked);
2. identify the **required ancestor relationship** (`ancestor:[data-active=true]`
   established here, refuted at the sibling place, open behind the opaque
   wrapper);
3. explain the competing declarations and cascade order for `color` at
   active ∧ dark — naming the defeat reason (`earlier-order`, same layer, tied
   specificity), with provenance to both authored spans;
4. carry a candidate repair across the other relevant places and partition the
   outcomes into changed / stable / ambiguous / inaccessible;
5. degrade honestly when an opaque component hides the structure — the place
   reports the boundary and raises the obligation instead of inventing an
   ancestor.

The fixture path: `e2e/rollup-app` gains a small un-bundled source file with the
three invocation places (active wrapper, inactive wrapper, opaque wrapper); the
standalone CLI rebuild refreshes the committed oracle fixture. The additions
carry no new CSS (prop-less `GroupItem`, plain wrappers), so the lane's
CLI-vs-host stylesheet parity and rendered-output asserts are unaffected.
`e2e/vite-app/src/App.tsx:114` remains the cross-snapshot negative: real
invocation, wrong snapshot → the correspondence guard must refuse it, not
answer from the rollup manifest.

## 5. Observations as evidence (charter step 5)

An observation is what was actually seen for one rendered element — from the
DOM, an SSR payload, or a hand-copied class list. It is evidence, not proof:
observations narrow possibilities or discharge particular unknowns, and they
never manufacture certainty.

```text
ObservedElement = optional tag + optional complete class list + optional
                  complete attribute map. An absent field is unobserved,
                  never empty.
Observation     = subject element + ancestor chain (innermost first) +
                  completeToRoot + source (dom | ssr | classes).
```

Two entries consume observations:

- **`locate(observation)`** — the observation-first entry. Components are
  identified by emitted class name membership (exact `className`, so it works
  where bare bindings collide and `resolveTarget` must refuse). Variant and
  state bindings are _proposed_ from the observed class grammar and _verified_
  by replaying `TargetResolution.classes(point)` — a proposal that fails
  replay is a conflict, never a binding. Every correspondence-checked place of
  a matched component is scored: `consistent`, `conditional` (possible only if
  a scoped refutation's beyond-file-root assumption fails — the note names the
  scope), or `contradicted` (with the specific conflict). The answer is a
  narrowing, never a pick.
- **`observe(place, observation)`** — evidence application. An open axis
  discharges to established when a satisfying observed ancestor exists
  (stateful axes never establish from a snapshot observation — structure
  cannot witness `:hover`), or to refuted when a complete-to-root chain has no
  satisfying element; the refutation is scoped to the observed chain, and an
  incomplete chain discharges nothing. A statically _scoped_ refutation plus
  an establishing observation rebinds — the observation discharges the
  beyond-file-root assumption, not the model. A genuine contradiction (a
  static established witness against a complete chain that lacks it) is
  surfaced and discharges **nothing** — the observation-generation analogue of
  the correspondence guard. Every discharge records its `evidence` source and
  adds an assumption naming the observation, so observation authority stays
  visible wherever the answer flows.

An observed `data-color-mode` ancestor implies the `mode` coordinate,
validated against the snapshot's declared modes — an undeclared value is a
conflict, never a fabricated coordinate. Deferred, deliberately: `carry`
still partitions from static places only (observed places feed `explain`),
and observations carry no interaction state.

## 6. Warm operation and cross-build uses (charter steps 5b–6)

Warmth never outlives the truth. The cold path's honesty guarantees are
properties of a moment; a warm process lives while the working tree and the
artifacts change under it, so both guarantees are re-established per
question:

- **Source, per question**: `structureOf` re-reads the file on every call and
  keys its cache by content — an edit after load flips the answer to
  `diverged`, and a revert restores it. Correspondence is a property of the
  file as it is now, never of the session's first look at it.
- **Artifacts, per request**: `revalidate()` compares the loaded
  `manifest.json` / `styles.css` / `commit.json` bytes against disk. A warm
  consumer that finds them changed is holding a dead generation and must
  refuse or reload — never keep answering.

The **session** is the warm surface: `animus-oracle session` reads one JSON
request per stdin line and writes one response per stdout line (human
narration stays on stderr). Ops: `snapshot`, `check`, `files`,
`invocations`, `unresolved`, `at`, `place`, `explain`, `carry`, `locate`,
`observe`, `shutdown`. Every op but `snapshot` revalidates first and refuses
with `stale-snapshot` once the artifact set is rebuilt; file-scoped ops
surface correspondence refusals as `refused`, never a bare null. The process
boundary stays reversible: the session is a loop over the same library
surface, not a daemon.

Two CI-facing uses ride the same guarantees:

- **`check`** — the correspondence guard as a batch gate: every snapshot
  file is verified against the working tree, the exit code is the verdict
  (0 corresponding, 1 diverged), and the JSON report names each failing
  file with its divergences.
- **`compareSnapshots(before, after)`** — cross-build identity at MVP depth:
  generations relate by program hash, components by id, places by
  (file, component, occurrence index) with per-axis binding drift reported
  for persisted places. Files refused on either side produce **no** place
  claims — they are listed as refusals instead. Deliberately not complete
  cross-build identity: a moved invocation reads as removed + added, and a
  renamed file breaks the thread.

## 7. What we are explicitly not beginning with

No browser/layout engine, no React tree simulator, no exhaustive context
enumeration, no globally installed daemon, no separate Rust service, no
universal geometry reasoning, no mandatory runtime instrumentation, no complete
cross-build identity. The charter's gates have been passed in order: one-shot
execution first, then the warm session once the answers proved valuable, then
the `check` gate and snapshot comparison once correspondence was credible
(§6) — but the warm surface remains a loop over the library, not a daemon,
and cross-build identity remains occurrence-deep, not complete.

## 8. Continue / narrow / pivot

- **Continue broadly** if real invocations usually resolve to small,
  understandable place sets; answers agree with Animus and selected browser
  witnesses; impact analysis discovers local axes automatically; context
  partitions collapse into useful outcome groups.
- **Narrow** toward change-first and definition-level analysis if source
  topology is usually opaque.
- **Pivot** if canonical semantics cannot be reused or mixed-generation
  snapshots cannot be prevented.
