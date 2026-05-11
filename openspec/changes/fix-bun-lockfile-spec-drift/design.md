## Context

The `bun-workspace` capability's active spec at `openspec/specs/bun-workspace/spec.md` makes five normative or scenario-level claims referencing `bun.lockb` (Bun's older binary lockfile format). The pinned Bun version (`.tool-versions: bun 1.3.11`) emits `bun.lock` (text format). The root `CLAUDE.md` carries one matching reference in a developer-facing instruction. None of the requirements describe behavior that depends on the lockfile's serialization format; the references are nominal (naming the file that `bun install` produces).

The drift likely entered when the bun-workspace spec was authored against an earlier Bun release. Subsequent migrations (TS7 adoption, oxlint, vp-run, etc.) did not surface the discrepancy because no requirement is gated on the filename. The lockfile on disk in this repo is `bun.lock`; `bun.lockb` does not exist.

## Goals / Non-Goals

**Goals:**

- Replace the 5 active-spec references and 1 root-CLAUDE.md reference to `bun.lockb` with `bun.lock`
- Preserve every requirement's behavior, scenarios, and structural relationships
- Produce a paper-trailed change archivable by the standard openspec workflow

**Non-Goals:**

- Modifying archived openspec changes (`openspec/changes/archive/*/`) — historical records remain as-is per the legacy/openspec convention
- Changing behavior or adding/removing requirements
- Auditing or modifying references to `bun.lockb` in legacy package CLAUDE.md files (those describe legacy packages and are out of scope for the active spec)

## Decisions

### Decision: Use MODIFIED for every affected requirement, with full content

The four affected requirements (`Bun as package manager`, `Simplified root scripts`, `No competing orchestration tools`, `Binding to orchestration-architecture`) are each rewritten in full under `## MODIFIED Requirements` in the spec delta. Per openspec semantics, MODIFIED replaces the entire requirement block at archive time; partial content silently loses detail.

Alternative considered: a "patch" style change listing only the affected sentences. Rejected because openspec's MODIFIED operator does not support partial replacement — partial blocks would erase the rest of each requirement on archive.

### Decision: Edit root CLAUDE.md directly outside the spec delta

The root `CLAUDE.md` is project-level user instructions, not under openspec governance. The single `bun.lockb` reference there is updated as part of this change's task list but does not appear in the spec delta. The task list records the edit so the change's paper trail is complete.

Alternative considered: leaving CLAUDE.md untouched and tracking the drift separately. Rejected because the user explicitly requested both fixed in one pass.

### Decision: Preserve original requirement order

The MODIFIED block lists requirements in the same relative order they appear in the source spec, per the openspec-modified-semantics convention that sibling order matters across archive.

## Risks / Trade-offs

- [Risk: archive-time content loss if MODIFIED blocks omit scenarios] → Mitigation: spec delta copies each requirement block verbatim from the source spec, edits only the lockfile filename token, and includes every original scenario.
- [Risk: future spec drift on the same axis] → Mitigation: low — the lockfile filename is a Bun-controlled identifier; if Bun changes it again, the same erratum process applies. No mechanism prevents drift entirely.
