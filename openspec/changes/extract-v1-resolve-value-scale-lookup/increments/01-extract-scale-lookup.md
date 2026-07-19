# Increment 01: extract V1 scale lookup

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Give V1 scale lookup one private named owner while preserving every
current scale outcome and all surrounding resolver behavior.

**Architecture:** Characterize `resolve_value()` directly while its inline
scale stage still exists. Then move only normalized lookup-value plus scale
resolution into `resolve_scale_value()`; negative normalization, transform
eligibility/evaluation, fallback, final CSS conversion, and all public callers
remain in their existing owners.

**Tech stack:** Rust 1.97, serde_json, Cargo, Vite+ verification, RepoWise
Distill.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/theme_resolver.rs` and this packet's
  completion fields only
- **Pushes to a later increment**: none; DEF-1 through DEF-7 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after live RepoWise, source, caller, test, and archived-decision
> evidence isolated the private V1 scale paragraph. Journal seed 2026-07-19
> 12:05 records row 01 as envelope-licensed.

## Context Capsule

- **Objective**: Add one exact direct matrix before production editing, prove
  that it passes against the inline implementation and that the requested
  helper structure is absent, then extract only the scale stage. Preserve the
  final `Option<Value>` state because it controls transform eligibility.
- **Verified finding disposition**: RepoWise rates
  `packages/extract/src/theme_resolver.rs` at health 3.98 and 99%-hotspot risk.
  `resolve_value()` is 98 NLOC, CCN 30, cognitive complexity 101, nesting 6.
  High-confidence plan `97b46b4ca95a4079b16707571d99297c` isolates the
  scale paragraph and estimates a 13-CCN reduction. Cross-file clones and the
  V2 counterpart are leads only: archived evidence says some duplication is
  intentional, and V1 is a behavioral oracle rather than a shared-code target.
- **Exact current scale outcomes** (direct final bytes are characterized before
  extraction; exact helper `Some`/`None` state is characterized after the
  helper exists):
  - absent scale → unresolved raw lookup value; transform remains eligible;
  - named theme scale hit → string theme value; miss → unresolved raw value;
  - inline object hit → cloned string or non-string map value; miss → raw;
  - empty array phantom → unresolved raw value but transform stays eligible;
  - non-empty array string/numeric member → resolved original lookup value;
    miss or mixed-type comparison → unresolved raw value;
  - only string and number lookup values form scale keys; boolean, object, and
    array lookup values do not resolve through a scale.
- **Current baselines**: target SHA-256
  `c87c4ec9ccc833e22f510ba7a5bbac03209d777d1a1698df833ef5e82052a79f`;
  protected foreign tracked diff
  `115b28c5ec3c111aa6d83a356b7941b568ca6dd69da1dc848fe22c2b0d03f72b`;
  G2 structure `0/0/1`; the focused G3 filter currently finds zero tests.
- **Relevant resolved decisions**: D1 one private scale helper; D2 direct
  outcome characterization before source extraction; D3 V1-only footprint;
  D4 exact V1 mapped owner claim.
- **Existing spec context**:
  `§arch-v1-scale-resolution-boundary/Isolated V1 scale resolution` covers this
  row; no requirement draft is owed.
- **In-scope North Star**: NS1 exact scale and transform-eligibility outcomes;
  NS2 one scale-policy owner; NS3 unchanged neighboring resolver policy; NS4
  engine-local V1 rollback unit; NS5 exact V1 source-map verification.
- **Prohibitions**: never use mutative Git. Do not write outside the declared
  footprint plus this packet's checkboxes/results. Do not edit `design.md`,
  `tasks.md`, `journal.md`, `specs/`, manifests, dependencies, public items,
  callers, negative handling, transform evaluation/fallback, placeholder
  formatting, CSS conversion, negation, aliases, globals, keyframes, V2 code,
  or any pre-existing dirty increment.

## Plan

### Task 01.1: Characterize existing scale outcomes first

- [x] Confirm the target is still clean, its SHA-256 is the packet baseline,
  and G5 still matches before editing:

```bash
git status --short -- packages/extract/src/theme_resolver.rs
shasum -a 256 packages/extract/src/theme_resolver.rs
git diff -- . ':(exclude)packages/extract/src/theme_resolver.rs' | shasum -a 256
```

Expected: empty target status, target hash `c87c4e...79f`, foreign hash
`115b28...72b`. STOP on drift and report it without editing.

- [x] In the existing `#[cfg(test)] mod tests`, immediately before
  `resolve_scale_lookup()`, add this configuration helper and direct matrix:

```rust
    fn scale_test_config(scale: Option<Value>, transform: Option<&str>) -> PropConfig {
        PropConfig {
            property: "test".to_string(),
            properties: vec![],
            scale,
            transform: transform.map(|name| name.to_string()),
            current_var: None,
            transform_fn_source: None,
        }
    }

    #[test]
    fn scale_lookup_preserves_existing_outcome_matrix() {
        let theme = test_theme();
        let cases = vec![
            ("no scale raw", json!("raw"), None, None, Some("raw")),
            (
                "no scale transform eligible",
                json!(3),
                None,
                Some("size"),
                Some("__TRANSFORM__size__3__"),
            ),
            (
                "named scale hit",
                json!(8),
                Some(json!("space")),
                Some("size"),
                Some("__TRANSFORM__size__0.5rem__"),
            ),
            (
                "named scale miss",
                json!(99),
                Some(json!("space")),
                Some("size"),
                Some("99"),
            ),
            (
                "inline object string hit",
                json!("sm"),
                Some(json!({ "sm": "15rem", "count": 2 })),
                Some("size"),
                Some("__TRANSFORM__size__15rem__"),
            ),
            (
                "inline object non-string hit",
                json!("count"),
                Some(json!({ "sm": "15rem", "count": 2 })),
                Some("size"),
                Some("__TRANSFORM__size__2__"),
            ),
            (
                "inline object miss",
                json!("lg"),
                Some(json!({ "sm": "15rem" })),
                Some("size"),
                Some("lg"),
            ),
            (
                "empty array phantom",
                json!("free"),
                Some(json!([])),
                Some("size"),
                Some("__TRANSFORM__size__free__"),
            ),
            (
                "non-empty string member",
                json!("sm"),
                Some(json!(["sm", "md"])),
                Some("size"),
                Some("__TRANSFORM__size__sm__"),
            ),
            (
                "non-empty numeric equivalent member",
                json!(2),
                Some(json!([2.0, 3.0])),
                Some("size"),
                Some("__TRANSFORM__size__2__"),
            ),
            (
                "non-empty array miss",
                json!(4),
                Some(json!([2, 3])),
                Some("size"),
                Some("4"),
            ),
            (
                "boolean lookup is unsupported",
                json!(true),
                Some(json!("space")),
                Some("size"),
                Some("true"),
            ),
            (
                "object lookup is unsupported",
                json!({ "nested": "value" }),
                Some(json!("space")),
                Some("size"),
                None,
            ),
            (
                "array lookup is unsupported",
                json!([1]),
                Some(json!("space")),
                Some("size"),
                None,
            ),
            (
                "empty string key does not resolve",
                json!(""),
                Some(json!("space")),
                Some("size"),
                Some(""),
            ),
            (
                "null lookup is unsupported",
                Value::Null,
                Some(json!("space")),
                Some("size"),
                None,
            ),
        ];

        for (name, value, scale, transform, expected) in cases {
            let config = scale_test_config(scale, transform);
            assert_eq!(
                resolve_value(&value, &config, &theme, None).as_deref(),
                expected,
                "{name}"
            );
        }
    }
```

- [x] Run G3 before production editing. Expected: one passing test. If any
  expected value is wrong, STOP and return the observed mismatch; do not
  change production to satisfy the test.
- [x] Run the production-bounded G2 commands before production editing.
  Expected honest structural RED: `0`, `0`, `1`.
- [x] Run the complete V1 library unit baseline after characterization:

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml --lib
```

### Task 01.2: Extract only scale resolution

- [x] Insert this private helper immediately before `resolve_value()`:

```rust
fn resolve_scale_value(
    lookup_value: &Value,
    scale: Option<&Value>,
    theme: &FlatTheme,
) -> Option<Value> {
    let scale_value = scale?;
    let key = match lookup_value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    };
    if key.is_empty() {
        return None;
    }

    match scale_value {
        Value::String(scale_name) => theme
            .get(&format!("{}.{}", scale_name, key))
            .cloned()
            .map(Value::String),
        Value::Object(inline_map) => inline_map.get(&key).cloned(),
        Value::Array(arr) if !arr.is_empty() => {
            let found = arr.iter().any(|item| match (item, lookup_value) {
                (Value::String(a), Value::String(b)) => a == b,
                (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
                _ => false,
            });
            if found {
                Some(lookup_value.clone())
            } else {
                None
            }
        }
        _ => None,
    }
}
```

- [x] In `resolve_value()`, replace only the inline `let mut resolved = None`
  scale block with:

```rust
    let resolved = resolve_scale_value(&lookup_value, config.scale.as_ref(), theme);
```

- [x] Immediately after the pre-edit direct matrix, add this helper-state
  matrix. It intentionally comes after production extraction because the
  private helper does not exist during characterization Task 01.1:

```rust
    #[test]
    fn scale_lookup_preserves_helper_option_state_matrix() {
        let theme = test_theme();
        let cases = vec![
            ("absent scale", json!(3), None, None),
            (
                "named scale hit",
                json!(8),
                Some(json!("space")),
                Some(json!("0.5rem")),
            ),
            ("named scale miss", json!(99), Some(json!("space")), None),
            (
                "inline string hit",
                json!("sm"),
                Some(json!({ "sm": "15rem" })),
                Some(json!("15rem")),
            ),
            (
                "inline non-string hit",
                json!("count"),
                Some(json!({ "count": 2 })),
                Some(json!(2)),
            ),
            (
                "inline miss",
                json!("lg"),
                Some(json!({ "sm": "15rem" })),
                None,
            ),
            ("empty array phantom", json!("free"), Some(json!([])), None),
            (
                "non-empty string member",
                json!("sm"),
                Some(json!(["sm", "md"])),
                Some(json!("sm")),
            ),
            (
                "non-empty numeric equivalent member",
                json!(2),
                Some(json!([2.0, 3.0])),
                Some(json!(2)),
            ),
            (
                "non-empty array miss",
                json!(4),
                Some(json!([2, 3])),
                None,
            ),
            ("boolean lookup", json!(true), Some(json!("space")), None),
            (
                "object lookup",
                json!({ "nested": "value" }),
                Some(json!("space")),
                None,
            ),
            ("array lookup", json!([1]), Some(json!("space")), None),
            ("empty string key", json!(""), Some(json!("space")), None),
            ("null lookup", Value::Null, Some(json!("space")), None),
        ];

        for (name, value, scale, expected) in cases {
            assert_eq!(
                resolve_scale_value(&value, scale.as_ref(), &theme),
                expected,
                "{name}"
            );
        }
    }
```

- [x] Run the repaired, production-bounded G2 commands. Expected final
  structural GREEN: `1`, `2`, `0`; test-only helper calls are intentionally
  outside this ownership count.
- [x] Run G3 and the complete V1 library unit command. Expected: focused 2/2
  and the full V1 library remains green.

### Task 01.3: Prove delta formatting, verify, and self-review

- [x] Run the live and baseline read-only Rust 1.97 formatting diagnostics.
  The committed file already fails whole-file formatting in `resolve_styles`,
  responsive/cascade helpers, negative normalization, public global/keyframe
  functions, and old tests. The live diagnostic may retain only those
  baseline-proven regions; the removed inline scale hunk is expected to vanish.
  STOP on any current-only hunk after the new-test formatter hunk already
  applied at the 12:35 friction checkpoint. Never format baseline-owned code.

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill rustfmt --edition 2021 --check packages/extract/src/theme_resolver.rs
repowise distill sh -lc 'git show HEAD:packages/extract/src/theme_resolver.rs | RUSTUP_TOOLCHAIN=1.97.0 rustfmt --edition 2021 --check'
```

- [x] Prove both increment-authored regions independently formatter-clean.
  Expected output is `0` then `0`; any nonzero byte count is a STOP because
  rustfmt emitted a diff or parse diagnostic for new code.

```bash
sed -n '/^fn resolve_scale_value(/,/^}/p' packages/extract/src/theme_resolver.rs | RUSTUP_TOOLCHAIN=1.97.0 rustfmt --edition 2021 --check 2>&1 | wc -c
sed -n '/^    fn scale_test_config(/,/^    fn resolve_scale_lookup()/p' packages/extract/src/theme_resolver.rs | sed '$d' | sed '$d' | sed '$d' | sed 's/^    //' | RUSTUP_TOOLCHAIN=1.97.0 rustfmt --edition 2021 --check 2>&1 | wc -c
```

- [x] Run G1-G5 exactly. Any mismatch is a STOP trip.
- [x] Run G6 in exact order. Follow only an exact printed fail-loud
  prerequisite remediation, using `repowise distill` for it as well.
- [x] Run `git diff --check`; inspect the target-only diff and confirm it
  contains one direct matrix, one private helper, and one bounded call-site
  replacement with no neighboring resolver-policy changes.
- [x] Update only this packet's completion fields with exact evidence,
  proposed journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1 public V1 resolver boundary:
  `git diff --unified=0 -- packages/extract/src/theme_resolver.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true`
  — result: exit 0 with empty output; no public declaration changed
- [x] G2 one production helper/one production call/old state absent: run the
  three production-bounded G2 commands from `design.md` — result: pre-edit
  `0/0/1`; final and post-G6 `1/2/0`
- [x] G3 exact scale outcome matrix:
  `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml theme_resolver::tests::scale_lookup_preserves_ --lib`
  — result: final 2 passed, 0 failed, 281 filtered; both the direct outcome and
  helper `Option<Value>` state matrices passed
- [x] G4 protected production regions: run the three marker-bounded SHA-256
  commands from `design.md` — result:
  `995914a1f03e4c6b3e8c461701250f50c57bfbdbd193c8d8cc91c24058fe9e76`,
  `c24b5ff9d57551375df87a6795436f1295070c15d13e8d3a2a3cc67013aed8d1`,
  `169c37d13a2fe0b46b10f46227459a5e857e4c6dd1b1dd002f51215bfe6047ac`
- [x] G5 protected foreign diff:
  `git diff -- . ':(exclude)packages/extract/src/theme_resolver.rs' | shasum -a 256`
  — result: `115b28c5ec3c111aa6d83a356b7941b568ca6dd69da1dc848fe22c2b0d03f72b`
- [x] G6 mapped chain, in order:
  `repowise distill vp run verify:clippy`; `repowise distill vp run verify:unit:rust`;
  `repowise distill vp run verify:canary`; `repowise distill vp run verify:integration`
  — result: strict Clippy exit 0; Rust units 640 passed/1 ignored at
  `repowise#ebfc89efec82`; canary 200 passed/0 failed with 4 snapshots and 432
  expects; integration 157 passed across 11 files

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail gate results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

Result: DONE. Pre-edit target
`c87c4ec9ccc833e22f510ba7a5bbac03209d777d1a1698df833ef5e82052a79f`
and foreign
`115b28c5ec3c111aa6d83a356b7941b568ca6dd69da1dc848fe22c2b0d03f72b`
hashes matched exactly. The direct matrix passed 1/1 with 281 filtered and the
structural RED was `0/0/1`; the full pre-production V1 library passed 282/282
at `repowise#3e353f7406ee`. After extraction, repaired G2 passed `1/2/0`,
focused G3 passed 2/2 with 281 filtered at `repowise#d4a5b9942d88`, and the V1
library passed 283/283 at `repowise#375ea26c3b1e`.

Execution first stopped twice without continuing later gates: old G2 counted
the mandatory helper-state test call (`1/3/0`), then whole-file rustfmt retained
pre-existing baseline drift after the delegate applied only the
formatter-proven new-test hunk. Reviewed repairs production-bounded G2 and
introduced live-versus-HEAD formatting evidence: zero current-only formatter
signatures and independently clean authored snippets (`0/0` bytes). The
baseline warning remains: whole-file Rust 1.97 formatting still reports only
committed drift in unrelated resolver and old-test regions.

G1-G5 then passed on the repaired tree, including fresh G3 2/2 at
`repowise#3c1a18884f22`, exact G4/G5 hashes, and zero current-only rustfmt
signatures. G6 command 1 stopped on `clippy::type_complexity` at the explicit
five-field direct-matrix vector annotation. The reviewed test-only repair
removed both local vector annotations and relied on inference; it added no
allow or production type. Fresh G3 after that repair passed 2/2 with 281
filtered at `repowise#c08601c8dd72`.

After that repair, strict Clippy passed and Rust units passed 640 with 1
ignored at `repowise#ebfc89efec82`. Canary failed loud on stale V1 NAPI,
the outer execution wrapper was reported as if `repowise distill vp run
build:extract` exited zero, and the immediate retry reported the same stale
source, so execution stopped again. No nested exit result was preserved; this
causal interpretation is superseded by the 14:28 correction below. Subsequent
read-only diagnosis found both V1 and V2 freshness predicates passing without
another build. The resumed canary then passed 200/200 with 4 snapshots and 432
expects, and integration passed 157/157 across 11 files.

The final fresh sweep passed G1-G5, authored formatting stayed `0/0`, and
`git diff --check` exited 0. Target-only review found one private helper, one
bounded production call, one direct outcome matrix, and one helper-state
matrix (`+236/-49`), with no negative, transform/finalization, negation, alias,
global, keyframe, public, caller, or V2 policy change.

### Proposed journal entries

- Surprise: the pre-edit direct matrix was green across all sixteen existing
  outcomes while structural G2 was the intended `0/0/1` RED.
- Friction: execution stopped cleanly on a test-call ownership collision,
  baseline-only rustfmt drift, Clippy tuple complexity, and a transient NAPI
  freshness anomaly; each resumption followed independent reviewed evidence.
- Signal: V1 scale resolution now has one private owner, and the exact mapped
  source, unit, NAPI, and integration boundaries remain green.

### Surfaced variables

- **Historical row-closure interpretation**:
  `napi-freshness-synchronization` was spawned as DEF-8 / row 09 because the
  nested build result was not available and ownership remained uncertain.
  The following correction supersedes that active-backlog disposition.
- **Post-verification correction (2026-07-19 14:28)**: later process/result
  evidence proved the symptom came from treating an outer orchestration cell
  as a completed nested build. DEF-8 and packetless row 09 are retired; no
  repository verification change is owed.
- No additional spawn candidate surfaced; DEF-1 through DEF-7 remain governed
  by their existing external signals.

## Spec authorship checklist (orchestrator)

- [x] Envelope-authored requirement confirmed unchanged
- [x] No Decision Ledger deferral resolved without its exact signal
- [x] Accepted journal entries appended with delegate attribution
- [x] Reorientation entry written with the required adversarial cadence
- [x] Registry row ticked with the reorientation timestamp
