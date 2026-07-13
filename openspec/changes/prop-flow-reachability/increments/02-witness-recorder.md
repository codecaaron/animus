# Increment 02: witness-recorder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking. No VCS steps — logical checkpoints only.

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: D4 (dev-only, buffered, transport-free witness recorder)
- **Authors**: §style-witness-recording/* (all four requirements)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/system/src/runtime/witness.ts` (new),
  `packages/system/src/runtime/resolveClasses.ts` (call sites),
  `packages/system/__tests__/witness.test.ts` (new)

**Goal:** In development, every class-resolution outcome (variant, state, system/custom
prop → `static` | `dynamic` | `drop`) appends a record to a bounded in-page buffer at
`globalThis.__ANIMUS_WITNESS__`, giving a true post-boundary reachability oracle.
Production bundles carry none of it.

**Architecture:** New single-responsibility module `witness.ts` (dev gate + ring buffer +
`recordWitness()`); `resolveClasses` calls it at each outcome. No transport, no
persistence (deferred — design.md DEF-4).

**Tech Stack:** TypeScript, Vitest (`bunx vp test run`).

## Context Capsule (cold-start)

- `resolveClasses` (`packages/system/src/runtime/resolveClasses.ts`) is the single choke
  point: variant classes pushed in the `config.variants` loop (~line 121-135), state
  classes in the `config.states` loop (~159-167), system/custom props in the
  `systemPropNames` loop (~174-217) with three outcomes: static hit
  (`classes.push(cls)`), dynamic slot (`if (dc)` branch), and silent fall-through
  (`else` — the sibling change `total-dynamic-floor` adds a drop diagnostic to this same
  branch; if it has landed, add the witness call beside the existing
  `warnDroppedValue(...)` call — the two are independent statements, order irrelevant).
- `key` (`serializeValueKey(propValue)`) is already computed in the system-prop loop —
  use it as the record's value. For variants/states use `String(value)` / `'true'`.
- Dev gate idiom (matches the sibling change):
  `typeof process === 'undefined' || process.env.NODE_ENV === 'production'` → return.
- The greppable exclusion token IS the global handle name `__ANIMUS_WITNESS__`
  (design.md G3 greps showcase dist for it). If a production build retains the dead
  string, G3 trips — remediate with call-site `process.env.NODE_ENV !== 'production'`
  guards so bundlers drop the import entirely; do not weaken G3.
- Vitest runs with `NODE_ENV=test` (recorder active). Reset state between tests with
  `delete (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__`.
- Test idiom: plain Vitest importing from `../src/...`
  (see `packages/system/__tests__/color-validation.test.ts`).
- Verification tiers (root CLAUDE.md Change-Type Map, `packages/system/src/**`):
  `verify:compile && verify:types && verify:unit:ts`.

## File Structure

- Create: `packages/system/src/runtime/witness.ts` — gate, buffer, `recordWitness`.
- Modify: `packages/system/src/runtime/resolveClasses.ts` — import + 5 call sites
  (variant, state, static hit, dynamic slot, drop).
- Create: `packages/system/__tests__/witness.test.ts`.

## Tasks

### Task 1: Failing tests

**Files:**
- Create: `packages/system/__tests__/witness.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

import { resolveClasses } from '../src/runtime/resolveClasses';
import { recordWitness, WITNESS_CAP } from '../src/runtime/witness';

type WitnessRecord = {
  component: string;
  prop: string;
  value: string;
  outcome: 'static' | 'dynamic' | 'drop';
};

const buffer = (): WitnessRecord[] =>
  (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__ as WitnessRecord[];

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('witness recording', () => {
  test('static, dynamic, and drop outcomes are witnessed through resolveClasses', () => {
    resolveClasses(
      'animus-W-a',
      { p: 8, m: 4, gap: 2 },
      { systemPropNames: ['p', 'm', 'gap'] },
      { p: { '8': 'animus-u-p8' } },
      { m: { varName: '--animus-m', slotClass: 'animus-dyn-m' } }
    );
    expect(buffer()).toEqual([
      { component: 'animus-W-a', prop: 'p', value: '8', outcome: 'static' },
      { component: 'animus-W-a', prop: 'm', value: '4', outcome: 'dynamic' },
      { component: 'animus-W-a', prop: 'gap', value: '2', outcome: 'drop' },
    ]);
  });

  test('variant and state resolutions are witnessed as static', () => {
    resolveClasses(
      'animus-W-b',
      { size: 'lg', active: true },
      {
        variants: { size: { options: ['sm', 'lg'] } },
        states: ['active'],
      }
    );
    expect(buffer()).toEqual([
      { component: 'animus-W-b', prop: 'size', value: 'lg', outcome: 'static' },
      { component: 'animus-W-b', prop: 'active', value: 'true', outcome: 'static' },
    ]);
  });

  test('buffer is a ring bounded by WITNESS_CAP', () => {
    for (let i = 0; i < WITNESS_CAP + 10; i++) {
      recordWitness('animus-W-c', 'p', String(i), 'static');
    }
    expect(buffer()).toHaveLength(WITNESS_CAP);
    expect(buffer()[0].value).toBe('10');
    expect(buffer()[WITNESS_CAP - 1].value).toBe(String(WITNESS_CAP + 9));
  });

  test('production mode records nothing and creates no global', () => {
    vi.stubEnv('NODE_ENV', 'production');
    recordWitness('animus-W-d', 'p', '1', 'static');
    resolveClasses('animus-W-d', { p: 8 }, { systemPropNames: ['p'] });
    expect(
      (globalThis as Record<string, unknown>).__ANIMUS_WITNESS__
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vp test run packages/system/__tests__/witness.test.ts`
Expected: FAIL — `witness.ts` does not exist (`Cannot find module '../src/runtime/witness'`).

### Task 2: Implement `witness.ts`

**Files:**
- Create: `packages/system/src/runtime/witness.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Dev-mode reachability witness: records every class-resolution outcome into a
 * bounded in-page ring buffer at globalThis.__ANIMUS_WITNESS__. Development
 * only — production builds must retain none of this (the handle name is the
 * greppable exclusion token).
 */

export type WitnessOutcome = 'static' | 'dynamic' | 'drop';

export interface WitnessRecord {
  component: string;
  prop: string;
  value: string;
  outcome: WitnessOutcome;
}

export const WITNESS_CAP = 5000;

export function recordWitness(
  component: string,
  prop: string,
  value: string,
  outcome: WitnessOutcome
): void {
  if (
    typeof process === 'undefined' ||
    process.env.NODE_ENV === 'production'
  ) {
    return;
  }
  const g = globalThis as { __ANIMUS_WITNESS__?: WitnessRecord[] };
  const buf = (g.__ANIMUS_WITNESS__ ??= []);
  buf.push({ component, prop, value, outcome });
  if (buf.length > WITNESS_CAP) {
    buf.splice(0, buf.length - WITNESS_CAP);
  }
}
```

- [ ] **Step 2: Wire the five call sites in `resolveClasses.ts`**

Add the import:

```ts
import { recordWitness } from './witness';
```

Variant loop — directly after the existing `classes.push(...)` (inside `if (value != null)`):

```ts
        recordWitness(baseClassName, prop, String(value), 'static');
```

State loop — directly after `activeStates.push(state)`:

```ts
        recordWitness(baseClassName, state, 'true', 'static');
```

System-prop loop — static hit, after `classes.push(cls)`:

```ts
        recordWitness(baseClassName, propName, key, 'static');
```

Dynamic branch — first line inside `if (dc) {`:

```ts
          recordWitness(baseClassName, propName, key, 'dynamic');
```

Fall-through — in the final `else` (beside `warnDroppedValue` if the sibling change
landed; otherwise create the `else`):

```ts
          recordWitness(baseClassName, propName, key, 'drop');
```

- [ ] **Step 3: Run the test file**

Run: `bunx vp test run packages/system/__tests__/witness.test.ts`
Expected: all 4 tests PASS.

### Task 3: Tier verification (logical checkpoint)

- [ ] **Step 1: Compile + types + unit tiers**

Run: `vp run verify:compile && vp run verify:types && vp run verify:unit:ts`
Expected: all PASS (on `ERROR: X missing. Run: Y`, run the named command and retry).

- [ ] **Step 2: Guardrail G3 (prod exclusion) — mandatory before tick**

Run: `vp run verify:build:showcase && rg -l "__ANIMUS_WITNESS__" packages/showcase/dist/`
Expected: build succeeds; `rg` prints nothing and exits 1. If it matches, add
`process.env.NODE_ENV !== 'production'` guards at the `resolveClasses` call sites so the
import tree-shakes, and re-run — do not weaken the check.

- [ ] **Step 3: Guardrail G4 (v1 frozen)**

Run: `git diff --name-only main -- packages/extract/src/`
Expected: empty output.

## Output contract

- `witness.ts` exists with `recordWitness`, `WITNESS_CAP`, dev gate, ring semantics;
  `resolveClasses` calls it at exactly the five outcomes above with no other behavior
  change.
- `witness.test.ts` passes; `verify:compile`, `verify:types`, `verify:unit:ts` pass;
  G3 and G4 checks pass as specified.
- Journal note at tick: buffer cap and handle name recorded; DEF-4 (feedback loop)
  remains open pending stable-witness dogfood on showcase dev.
