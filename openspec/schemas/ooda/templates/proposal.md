## Why

<!--
Explain the motivation for this change. What problem does this solve? Why now?

Hard limit: 50 <= characters <= 1000 (OpenSpec's zod schema validates this).
- Too short -> "Why section must be at least 50 characters" error
- Too long  -> "Why section should not exceed 1000 characters" error

Suggested structure: current pain point -> why address it now -> expected
benefit (1-2 sentences each).
-->

## What Changes

<!--
ONE LINE per change — a plain list. No From/To blocks, no decision
restatements: decision state lives in design.md (which WINS over this file on
any disagreement); point there rather than paraphrasing it. This proposal's
load-bearing content is the Why and the capability enumeration below.

Keep this to the WHAT-summary. Decomposition into increments (and their
execution modes) belongs in tasks.md's Increment Registry; deferrals,
steering, and guardrails belong in design.md — do NOT enumerate increments
here.
-->

## Capabilities

### New Capabilities

<!--
Capabilities being introduced. Replace <name> with a kebab-case compound noun
of at least two words (user-auth, data-export, api-rate-limiting — not a bare
single word). Each creates specs/<name>/spec.md. The prefix `arch-` is
RESERVED for architectural-constraint capabilities (executable-check-backed
requirements; see spec.md template) — use it deliberately.
-->

- `<name>`: <brief description of what this capability covers>

### Modified Capabilities

<!--
Existing capabilities whose REQUIREMENTS are changing (not just
implementation). Each needs a delta spec file. Use existing spec names from
openspec/specs/. Leave empty if no requirement changes.
-->

- `<existing-name>`: <what requirement is changing>

## Impact

<!-- Affected code, APIs, dependencies, systems -->
