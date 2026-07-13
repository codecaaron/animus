# Brainstorm — enforce-workspace-topology

> Raw capture. Produced during an autonomous `explore` pass on 2026-07-07;
> evidence chain and reasoning preserved in the order it happened.

## Background: what exploration found

Root `CLAUDE.md` § One-Way Dependency Rule documents the topology contract:

- `e2e/*` MAY import `packages/*`
- `packages/*` MUST NOT import `e2e/*`
- neither `packages/*` nor `e2e/*` may import `legacy/*`

and then states, verbatim: **"No automated enforcement yet — candidate for a
future CI grep or lint rule."** This change is that candidate, cashed in.

Current compliance, verified today:

- `rg` for imports of `e2e/` from `packages/`: **0 hits**
- `rg` for imports of `legacy/` from `packages/` or `e2e/`: **0 hits**

So enforcement locks in an already-clean state — no remediation work rides
along with the check.

Structural facts that shape the enforcement design:

- **Legacy packages have no `package.json` at all** (verified:
  `legacy/core/` has src + tsconfigs only). They cannot be resolved by
  package name; the only realistic import vectors into `legacy/` are
  _relative paths_ crossing the top-level boundary and _tsconfig path
  aliases_.
- `packages/* → e2e/*` has a third vector: workspace `package.json`
  dependencies (e2e apps are real workspaces with names).
- Two main-tree specs already describe the topology and pass validation:
  `legacy-directory-topology` (7 requirements) and `e2e-workspace-convention`
  (6 requirements, including the one-way rule itself). They specify the
  _convention_; neither specifies an _automated check_.

## Why this matters now (not later)

The rule currently holds by discipline alone, and the repo's own docs flag
that as a gap. The new `superpowers-ooda` schema introduces an `arch-*` spec
namespace purpose-built for exactly this shape of requirement — a negative
structural invariant backed by an executable check. This change is small,
self-contained, and a natural first inhabitant of that namespace: it
exercises the new taxonomy on a real constraint before bigger changes rely
on it.

## Approaches considered

**A. rg-based boundary greps wired into the fast verify gate (recommended).**
Three greps (packages→e2e imports, packages/e2e→legacy imports, packages→e2e
package.json deps) plus a tsconfig-paths scan, packaged as a script with a
loud failure listing offending files. Runs in well under 2s, zero deps, easy
to reason about. False-positive surface: comments/strings mentioning the
paths — mitigated by matching import/require/from syntax, not bare substrings.

**B. Full dependency-graph analysis (parse imports via oxc, walk workspace
graph).**
Strictly more precise, catches exotic vectors (dynamic import expressions,
re-exports). Rejected for now: heavy for a rule with zero current violations;
the graph tooling doesn't exist yet and the payoff over greps is marginal.
Revisit if greps ever produce a false result in either direction.

**C. Lint rule (oxlint plugin / no-restricted-imports config).**
Attractive because it surfaces in-editor, but oxlint custom-rule/config
support for cross-workspace path restrictions is not established in this
repo, and it wouldn't cover the package.json-dependency vector. Could layer
on later; not the enforcement backbone.

## KNOWN-NOW vs DEFERRED

KNOWN-NOW:

- The rule semantics — already written down in CLAUDE.md and the two
  existing specs; nothing to renegotiate.
- Enforcement is check-only (a verify surface, not a hygiene mutation —
  hygiene is for mutating cleanup, wrong home).
- The check must cover three vectors: source imports (relative paths),
  tsconfig `paths` aliases, and `package.json` workspace deps.
- The spec home is a new `arch-workspace-topology` capability: each
  requirement's scenario names the runnable check (the arch-\* admission
  test).
- Per CLAUDE.md's ownership rule, the Change-Type Map gets a row for the new
  check's edit surface in the same change.

DEFERRED (each with its resolving signal):

- **Exact tier placement** (extend `verify:lint` vs a new
  `verify:topology` atomic tier) — signal: measured runtime of the
  prototype check; if it stays "fast" (<2s), it can join the fast gate;
  the `vite.config.ts` `run.tasks` graph decides ergonomics.
- **Whether the check also validates `bun.lock`/install-time linkage** (a
  legacy package accidentally re-gaining a package.json and entering the
  workspace) — signal: first occurrence, or the triage of workspace-glob
  configs showing it is actually representable. Sketch cost is low but may
  be pure ceremony.
- **In-editor lint layering (approach C as a supplement)** — signal:
  a real violation caught only at verify-time that editor feedback would
  have prevented.

## Candidate NORTH STAR criteria

- NS1: The check fails loud and specific — output names every offending
  file/dependency edge, mirroring the repo's "ERROR: X missing. Run: Y"
  convention.
- NS2: Zero false positives on the current tree, proven before wiring into
  any gate.
- NS3: The check stays dependency-free and fast enough for the inner loop
  (provisional — revisit if approach B ever becomes necessary).

## Candidate GUARDRAILS

- G1: SHALL NOT modify anything under `legacy/` (its contents are archived).
  Check sketch: `git status --short legacy/` is empty after every increment.
- G2: SHALL NOT add runtime dependencies to any publishable package for
  enforcement tooling. Check sketch:
  `git diff packages/*/package.json | rg '^\+.*"dependencies"'` empty.
- G3: SHALL NOT weaken existing verify tiers — the new check is additive.
  Check sketch: `vp run verify` passes before and after.
