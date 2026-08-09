# arch-runtime-gate-integrity Specification

## Purpose

The runtime gate drops invalid dynamic values atomically and stays QuickJS-safe.

## Requirements
### Requirement: Dropped dynamic values drop atomically

When the runtime gate rejects a dynamic prop value, it SHALL drop the whole value atomically: zero slot classes and zero CSS variable writes for that value, with a `drop` witness recorded. Entries staged by an earlier prop SHALL survive a later prop's drop. A partial application — some breakpoint slots written before the invalid one was found — is a violation even when the final render looks plausible.

#### Scenario: Atomic-drop unit anchors pass

- **WHEN** the following command is run

```bash
bunx vp test run packages/system/__tests__/drop-diagnostic.test.ts packages/system/__tests__/witness.test.ts
```

- **THEN** it exits 0, including the case of a responsive object with one invalid breakpoint result producing zero slot classes, zero variable writes, and witness `drop`
- **AND** including the two-prop staging pair: an earlier prop's entries survive a later prop's drop

### Requirement: Runtime gate code stays QuickJS-safe

Runtime gate code under `packages/system/src/runtime/` SHALL evaluate in QuickJS: no `TextEncoder`/`TextDecoder`, no WHATWG globals, no Node-only APIs (`process.*`, `Buffer`, `fetch`). The system dist must load in engines with none of these installed. Known blind spot: the executable check greps `resolveClasses.ts` — the runtime gate's single witness seam — not every file in the directory; an unsafe API introduced in a new runtime file rides only until it reaches the gate path.

#### Scenario: No WHATWG or Node APIs in the runtime gate

- **WHEN** the following command is run

```bash
grep -rn "TextEncoder\|TextDecoder\|process\.\|Buffer\|fetch(" packages/system/src/runtime/resolveClasses.ts; echo "exit=$?"
```

- **THEN** it prints no matches and `exit=1` (grep's no-match exit code is the passing state; any printed match is a violation)

