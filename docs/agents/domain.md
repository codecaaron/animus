# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Also check `packages/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a multi-context repo. Contexts are packages under `packages/`, not `src/` subdirectories:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
├── packages/
│   ├── extract/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                  ← context-specific decisions
│   └── system/
│       ├── CONTEXT.md
│       └── docs/adr/
└── e2e/                               ← consumer fixtures; no contexts of their own
```

## Relationship to OpenSpec

`openspec/specs/` (local, gitignored) is the authoritative requirement surface for behavior contracts in this repo. ADRs record architectural rationale and trade-offs, not requirements — when a decision is already owned by an openspec spec, link to it rather than duplicating it. Flag conflicts with a spec the same way as ADR conflicts (below).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
