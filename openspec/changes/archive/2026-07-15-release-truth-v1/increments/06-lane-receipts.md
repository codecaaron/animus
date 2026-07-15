# Increment 06: lane-receipts

## Scope

- **Registry row**: 06 · mode: delegate · review: subagent
- **Resolves**: D4 (the existing-lanes half; the packed lane's receipt
  landed with increment 02)
- **Authors**: — (envelope: §dual-engine-build/Engine identity in
  verification receipts and Engine execution scope across lanes already
  authored)
- **Depends on (ordering — deps:)**: 02 (footprint overlap on
  `scripts/verify/**`; the packed receipt sets the shape precedent)
- **Inputs from (information — inputs:)**: none (the receipt schema is
  fixed by the envelope spec, not by increment 02's output)
- **Footprint**: `packages/_assertions/**`, `scripts/verify/**`,
  `e2e/next-app/scripts/**`, `e2e/vite-app/scripts/**`,
  `packages/showcase/scripts/**`
- **Pushes to a later increment**: none (the conformance-matrix renderer
  over these receipts is explicitly out of scope — deferred until gates
  emit structured results everywhere)

> Resolving signal: envelope-licensed (implements decided-now D4).

## Context Capsule

- **Objective**: Every consumer-facing lane that already exists —
  `verify:assert:next`, `verify:assert:vite`, `verify:assert:showcase`
  (and thereby the `verify:next`/`verify:vite`/`verify:showcase`
  composites) — emits a JSON receipt with the fields: `lane`, `host`,
  `hostVersion`, `mode`, `engineLoaded`, `engineDefault`,
  `engineOverride`, `packageForm`. Receipts make a default-engine flip
  observable without reading lane logs.
- **In-scope guardrails**: none per-increment (G-register has no receipt
  guardrail; the spec scenarios are the acceptance tests).
- **Requirements to draft**: none — envelope covers.
- **Existing spec context**: change-level `specs/dual-engine-build/spec.md`
  → both requirements. Field list there is normative.
- **Relevant resolved decisions (constraints)**:
  - D4: receipts, not a renderer; consumer fixtures run their intended
    default engine only.
  - Receipt shape precedent: increment 02's
    `e2e/packed-app/.staging/receipts/packed.json`.
- **Repo facts a cold agent needs**:
  - Assert lanes end with `exec bun run <fixture>/scripts/assert-build.ts`
    (see `scripts/verify/assert-vite.sh`, `assert-next.sh`,
    `assert-showcase.sh` for the exact per-fixture paths). Those TS scripts
    run in WORKSPACE context and import `@animus-ui/assertions` — the right
    home for a shared receipt helper is
    `packages/_assertions/src/receipt.ts`, exported from the package index.
  - Engine facts: both plugins default to `'v2'`. The vite plugin's
    `engine` option is resolved in `packages/vite-plugin/src/index.ts`
    (locate via `rg -n "options.engine" packages/vite-plugin/src/index.ts`);
    the next plugin's in `packages/next-plugin/src/singleton.ts` (locate
    via `rg -n "getSharedEngine" packages/next-plugin/src/singleton.ts`).
    A fixture overrides ONLY by passing `engine` in its own config file —
    detect by reading the fixture's config source for an `engine:` key
    (e.g. `rg -n "engine\s*:" e2e/vite-app/vite.config.ts` — no match
    means default).
  - `hostVersion`: read from the fixture's installed host package, e.g.
    `require('e2e/vite-app/node_modules/vite/package.json').version` —
    NOT from the range in the fixture manifest.
  - `packageForm` for all three existing fixtures is `'workspace'`.
  - Receipt location convention: write to
    `<fixture>/.receipts/<lane>.json`; add `.receipts/` to root
    `.gitignore` if not covered (footprint note: a one-line `.gitignore`
    append is within the spirit of this row; record it in the output
    contract).
- **In-scope North Star criteria**: NS1 (engine dimension recorded), NS5
  (default-engine-only in consumer fixtures).
- **Prohibitions**: no version-control commands; no writes outside the
  declared footprint (plus the `.gitignore` line and this file); never
  write to design.md, tasks.md, journal.md, or specs/ — return drafts in
  the output contract; do NOT change which engine any fixture runs.

## Plan

## Task 06.1: Shared receipt helper

- [x] **Step 1:** Create `packages/_assertions/src/receipt.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LaneReceipt {
  lane: string;
  host: 'vite' | 'next';
  hostVersion: string;
  mode: 'production' | 'dev';
  engineLoaded: 'v1' | 'v2';
  engineDefault: 'v1' | 'v2';
  engineOverride: boolean;
  packageForm: 'workspace' | 'packed';
}

export function writeLaneReceipt(path: string, receipt: LaneReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
}
```

- [x] **Step 2:** Export it from the package index (locate via
`ls packages/_assertions/src/` — add `export * from './receipt';` to
`index.ts`).

- [x] **Step 3:** Add a unit test
`packages/_assertions/__tests__/receipt.test.ts` asserting a receipt
round-trips through `writeLaneReceipt` and JSON.parse with all eight
fields intact. Run: `bunx vp run verify:unit:ts` — expected: pass,
including the new test.

- [x] **Step 4:** Rebuild the assertions dist so downstream lanes see the
new export. Run: `bun run --filter '@animus-ui/assertions' build:ts` —
expected: exit 0.

## Task 06.2: Emit receipts from the three assert scripts

- [x] **Step 1:** In `e2e/vite-app/scripts/assert-build.ts`, after the
existing assertions pass, add:

```ts
import { writeLaneReceipt } from '@animus-ui/assertions';

writeLaneReceipt(new URL('../.receipts/verify-assert-vite.json', import.meta.url).pathname, {
  lane: 'verify:assert:vite',
  host: 'vite',
  hostVersion: (await import('vite/package.json', { with: { type: 'json' } })).default.version,
  mode: 'production',
  engineLoaded: 'v2',
  engineDefault: 'v2',
  engineOverride: false,
  packageForm: 'workspace',
});
```

If the JSON-module import form fails under the runtime in use, fall back to
`createRequire(import.meta.url)('vite/package.json').version` — but per the
repo's Bun `createRequire` caveat (root CLAUDE.md § Key Rules), use a
direct relative path if the specifier form misresolves. Set
`engineOverride`/`engineLoaded` from the fixture config: if
`rg -n "engine\s*:" e2e/vite-app/vite.config.ts` matches, mirror that
value and set `engineOverride: true`; hard-code neither — read the config
source once at script start.

- [x] **Step 2:** Same pattern in `e2e/next-app/scripts/assert-build.ts`
(lane `verify:assert:next`, host `next`, version from
`next/package.json`, config probe `rg -n "engine\s*:" e2e/next-app/next.config.ts`).

- [x] **Step 3:** Same pattern in the showcase assert script (locate via
`rg -n "assert-build" scripts/verify/assert-showcase.sh` for the exact
path; lane `verify:assert:showcase`, host `vite`).
  - NOTE: the real path is `scripts/assert-showcase-build.ts` (repo-root
    `scripts/`), NOT `packages/showcase/scripts/` as the Footprint list
    assumed. Edited the real file per this step's "locate the exact path"
    directive. Surfaced in the output contract.

- [x] **Step 4:** Append `.receipts/` to root `.gitignore` if
`rg -n "receipts" .gitignore` has no hit.

## Task 06.3: Prove the lanes emit

- [x] **Step 1:** Run: `bunx vp run verify:vite && bunx vp run verify:next && bunx vp run verify:showcase`
Expected: all exit 0.

- [x] **Step 2:** Run:
`for f in e2e/vite-app/.receipts/*.json e2e/next-app/.receipts/*.json packages/showcase/.receipts/*.json; do bun -e "const r=require('$f'); for (const k of ['lane','host','hostVersion','mode','engineLoaded','engineDefault','engineOverride','packageForm']) if (!(k in r)) throw new Error('$f missing '+k); console.log('$f ok')"; done`
Expected: three `ok` lines.

## Guardrail gate

- [x] No per-increment guardrails in scope. Record "none in scope" in the
      output contract.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Drafted requirement text: none owed (`authors: —`)
- [x] Guardrail gate results recorded (expected: "none in scope")
- [x] Proposed journal entries (surprise / friction), 1–3 lines each
- [x] Surfaced variables (spawn candidates), or "none"

### Results

All three existing consumer lanes now emit an eight-field JSON receipt; the
packed-lane precedent (`scripts/verify/packed.sh`) is mirrored, and engine
facts are MEASURED (not hardcoded): `engineLoaded`/`engineOverride` read the
in-effect `ANIMUS_ENGINE` env against a config guard, `engineDefault` is read
from the workspace plugin source (`options.engine ?? 'v2'` /
`getSharedEngine() … || 'v2'`), `hostVersion` from the fixture's installed
host `package.json`.

Guardrail gate: **none in scope** (G-register has no receipt guardrail; the
spec scenarios are the acceptance tests).

Verbatim receipts (default engine, all lanes green):

```jsonc
// e2e/vite-app/.receipts/verify-assert-vite.json
{ "lane": "verify:assert:vite", "host": "vite", "hostVersion": "8.1.4",
  "mode": "production", "engineLoaded": "v2", "engineDefault": "v2",
  "engineOverride": false, "packageForm": "workspace" }
// e2e/next-app/.receipts/verify-assert-next.json
{ "lane": "verify:assert:next", "host": "next", "hostVersion": "15.5.20",
  "mode": "production", "engineLoaded": "v2", "engineDefault": "v2",
  "engineOverride": false, "packageForm": "workspace" }
// packages/showcase/.receipts/verify-assert-showcase.json
{ "lane": "verify:assert:showcase", "host": "vite", "hostVersion": "8.1.4",
  "mode": "production", "engineLoaded": "v2", "engineDefault": "v2",
  "engineOverride": false, "packageForm": "workspace" }
```

Override proof (measurement is live, not baked): running
`ANIMUS_ENGINE=v1 bun run e2e/vite-app/scripts/assert-build.ts` flips the
receipt to `engineLoaded: "v1"`, `engineOverride: true` while `engineDefault`
stays `"v2"`; default receipt restored afterward.

`.gitignore`: appended `.receipts/` (one line) under the packed-staging block.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers)
- [ ] Ledger: none to flip (D4 fully implemented once 02 + 06 are both
      ticked — note that in the reorientation)
- [ ] Appended accepted journal entries (attributed `via inc 06 subagent`)
- [ ] Reorientation entry written per cadence
- [ ] Ticked registry row 06 in tasks.md with `· ticked: <timestamp>`
