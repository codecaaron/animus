# Proposal — formalize-style-verification

## Why

AI agents editing Animus UIs today verify changes through dev servers, screenshots, and vision-model judgment: seconds per check, nondeterministic, and explanation-free. The 2026-07-19 investigation established that Animus's closed style universe and fully static cascade make a substantial subset of UI styling formally verifiable at millisecond cost — the kernel (`ExtractEngine`), the fact graph (UniverseManifest), and the replayable resolver (`resolveClasses`) already exist, with no shipped analog in any competing styling system. What is missing is a versioned, evidence-carrying verdict contract and the plumbing around it. Recording the epic now fixes the claim boundary (zero false-exact answers) before anything optimizes against the verifier.

## What Changes

- Define the versioned StyleGoal + VerdictEnvelope contract (verdicts: `exact | divergent | conditional | unverifiable`) with evidence, environment, assumptions, and `runtime_confirmation_required` on every answer.
- Factor a headless analysis session (system load + file discovery + long-lived `ExtractEngine` + universe index + `resolveClasses` replay) out of the plugins; expose it as a CLI and MCP surface registered per `verification-tier-policy` (see design.md for sequencing).
- Add two additive Rust facts required for verdict honesty: static callsite spans and spread-presence markers (existing outputs stay byte-identical).
- Produce semantic universe diffs (components, declarations, residue, drops, provenance edges) and surface them as PR governance comments; includes equivalence verdicts scoped "over observable contract X and covered region Y".
- Introduce a typed AnimusPatch IR applied by deterministic codemod (span-addressed `EmissionPlan`), plus Goodhart-safe speculative best-of-N selection (`unverifiable` scores below `divergent`).
- Persist a content-addressed universe snapshot per commit (universe ledger) and build style bisect/blame on ledger comparison, not historical re-analysis.
- Stamp witness records with manifest digest, build identity, mode, and epoch so runtime-vs-predicted triage is trustworthy.
- Later stages (design.md Ledger): inverse style solver with universe-extension escape valve; symbolic equivalence; training/reward research on declaration-set fidelity as a verifiable subreward.

## Capabilities

### New Capabilities

- `style-verdict-contract`: the versioned StyleGoal/VerdictEnvelope schema — goal language, verdict taxonomy, evidence envelope, environment stamping, and the zero-false-exact obligation.
- `headless-analysis-session`: server-free workspace analysis — system loading, discovery, long-lived engine, universe index, replay kernel — plus its CLI/MCP query surface.
- `callsite-provenance-facts`: additive extraction facts for static system-prop callsites (file + span) and spread-presence markers on JSX elements.
- `semantic-universe-diff`: normalized manifest-to-manifest diffing, equivalence verdicts over contract/region, and the PR governance comment artifact.
- `style-patch-ir`: the typed AnimusPatch representation, per-project schema compilation from the manifest, and deterministic codemod application.
- `speculative-edit-selection`: multi-candidate speculation and best-of-N filtering with Goodhart-safe scoring over verdicts.
- `universe-snapshot-ledger`: content-addressed, schema-stamped per-commit universe persistence in CI.
- `style-history-bisect`: bisect/blame over ledger snapshots with graceful degradation for unanalyzable commits.
- `inverse-style-solver`: StyleGoal → ranked candidate configurations over the finite region, with explicit universe-extension proposals for out-of-region targets.

### Modified Capabilities

- `style-witness-recording`: witness records/envelope must carry manifest digest, build identity, mode, and epoch; comparison without a matching envelope is prohibited.
- `verification-tier-policy`: harness commands register as `vp run` tiers and add their Change-Type Map rows.

(The UniverseManifest field additions are owned entirely by the new `callsite-provenance-facts` capability to keep one writer per requirement across open changes; `project-analyzer` is affected as implementation surface only — see Impact.)

## Impact

- **New workspace package** (name settled in design.md) hosting session core, CLI, MCP server, diff/governance, patch applier, solver.
- **`packages/extract/crates/extract-v2/`**: additive facts in jsx scan/usage facts + manifest serialization; parity baselines must remain byte-identical for existing fields.
- **`packages/system`**: witness record envelope fields (dev-only surface).
- **Plugins (`vite-plugin`, `next-plugin`)**: optional manifest artifact emission for live-tap parity (not on the critical path).
- **CI**: ledger persistence step; PR comment workflow.
- **`AGENTS.md`**: Change-Type Map rows for the new edit surfaces (ownership rule).
- **Dependencies**: no new runtime dependencies for consumers; harness is repo-internal until adoption pressure says otherwise (design.md North Star).
