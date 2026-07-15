# restore-spec-tree-integrity

## Why

79 of 116 specs in the main tree fail `openspec validate --all`: 40 contain raw delta headers archived verbatim, 70 lack the canonical `## Purpose`/`## Requirements` wrapper, and one shipped capability (`prop-strict-mode`) has no main-tree spec at all. The repo just adopted the `superpowers-ooda` schema, whose archive step syncs future deltas into this same tree — syncing into a corrupt tree compounds the damage, and `openspec validate --all` cannot become a regression gate while it fails.

## What Changes

**Wrapper-less specs (70 files)**
- From: canonical requirement text with no `## Purpose`/`## Requirements` sections; validator counts 0 requirements.
- To: same requirement text wrapped in the canonical section structure, plus a minimal Purpose paragraph.
- Reason: validator parses sections, not bare `### Requirement:` blocks.
- Impact: non-breaking; requirement text preserved byte-for-byte.

**Delta-header specs (40 files)**
- From: `## ADDED / MODIFIED / REMOVED Requirements` delta sections sitting in the main tree.
- To: deltas deterministically merged into a canonical body (ADDED appended, MODIFIED replaced in place, REMOVED dropped with recorded reason).
- Reason: the main tree holds current-state specs; deltas belong to changes.
- Impact: non-breaking; merge is mechanical, no new requirement text authored.

**prop-strict-mode bookkeeping**
- Backfill `openspec/specs/prop-strict-mode/spec.md` from the archived delta (the feature is already implemented in `packages/system/src/types/config.ts`).
- Rename `openspec/changes/archive/prop-strict-mode/` to the standard `YYYY-MM-DD-` prefixed form (rename only, content untouched).

**Regression guard (deferred until the tree is green)**
- Once `validate --all` passes, wire it in as a cheap blocking gate so the tree cannot silently rot again.

Content triage (stale specs, empty dirs, taxonomy migration of 118 impl-leak hits into an `arch-*` namespace) is deliberately staged behind the mechanical repair — see design.md deferrals when authored.

## Capabilities

### New Capabilities
- `arch-spec-corpus`: architectural constraint that the main spec tree stays canonical and machine-valid — every `openspec/specs/*/spec.md` passes `openspec validate --all` and contains no delta-format headers, backed by executable checks (`openspec validate --all --json`; `rg -n '^## (ADDED|MODIFIED|REMOVED|RENAMED)' openspec/specs/`).

### Modified Capabilities

(none — this change repairs the *format* of existing specs; no capability's requirements change. Any requirement-content changes surfaced by triage will be proposed as their own follow-up change.)

## Impact

- `openspec/specs/**` — 79 files reformatted, 1 capability dir added (`prop-strict-mode`), `arch-spec-corpus/` added.
- `openspec/changes/archive/prop-strict-mode/` — directory rename only.
- No package code, build, or CI behavior changes in the mechanical phase; the regression-gate increment may touch CI or hygiene config once the tree is green.
- Per CLAUDE.md, `openspec/**` changes need no verify tier — `openspec validate` is the acceptance check.
