# Increment 01: runtime-drop-diagnostic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking. No VCS steps — logical checkpoints only.

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D2 (dev-mode drop diagnostic), D4 (lookup precedence unchanged)
- **Authors**: §dynamic-prop-fallback/Runtime drop diagnostic
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/system/src/runtime/resolveClasses.ts`,
  `packages/system/__tests__/drop-diagnostic.test.ts`

**Goal:** In development builds, a system/custom prop value that matches neither a static
utility class nor any dynamic prop configuration emits a `console.warn` naming the
component base class, prop, and serialized value — instead of vanishing silently.
Production bundles contain no trace of the diagnostic.

**Architecture:** One guarded helper added to `resolveClasses.ts` (the single choke point
both `createComponent` and `createClassResolver` route through), called from the existing
fall-through branch. Module-level `Set` dedupes to one warning per
`(baseClassName, prop)` pair per session (initial policy; escalation is deferred —
design.md DEF-2). Lookup order (`customPropMap`/`systemPropMap` → dynamic config →
diagnostic) is untouched.

**Tech Stack:** TypeScript, Vitest (`bunx vp test run`), oxlint (`no-console` needs the
repo's standard disable comment).

## Context Capsule (cold-start)

- The target function is `resolveClasses` in
  `packages/system/src/runtime/resolveClasses.ts`. The fall-through today (lines
  ~180-216): `cls = customPropMap?.[prop]?.[key] ?? systemPropMap?.[prop]?.[key]`; if
  falsy, `dc = customDynamicConfig?.[prop] ?? dynamicPropConfig?.[prop]`; `if (dc) {...}`
  has **no else** — that missing else is the silent drop.
- `serializeValueKey(value)` (same file, exported) produces the lookup key; reuse it in
  the message so the logged key matches what failed the lookup.
- Repo warning convention (see `packages/system/src/theme/createTheme.ts:619-622`):
  `console.warn` with an `[animus]` prefix, preceded by
  `// oxlint-disable-next-line no-console -- intentional runtime diagnostic`.
- The message MUST contain the greppable token `animus:drop` — design.md guardrail G3
  verifies production bundles with `rg -l "animus:drop" packages/showcase/dist/`.
- Dev gate: `typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'`
  (the `typeof` guard keeps non-bundled browser ESM safe; bundler `define` still folds
  the whole expression to `false` in prod and dead-code-eliminates the branch).
- Tests live in `packages/system/__tests__/*.test.ts`, plain Vitest, importing from
  `../src/...` (see `color-validation.test.ts` for the idiom). Vitest runs with
  `NODE_ENV=test`, so the diagnostic is active by default; use `vi.stubEnv` for the
  production case. Use **unique base class names per test** so the module-level dedup
  Set never leaks state between tests (no reset hook needed or wanted).
- Verification tiers for this footprint (root CLAUDE.md Change-Type Map,
  `packages/system/src/**`): `verify:compile && verify:types && verify:unit:ts`.

## File Structure

- Modify: `packages/system/src/runtime/resolveClasses.ts` — add `warnDroppedValue`
  helper + one `else` branch. No signature changes, no new exports besides none.
- Create: `packages/system/__tests__/drop-diagnostic.test.ts` — behavior of the
  diagnostic and the precedence invariants.

## Tasks

### Task 1: Failing tests for the drop diagnostic

**Files:**
- Create: `packages/system/__tests__/drop-diagnostic.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';

import { resolveClasses } from '../src/runtime/resolveClasses';

const config = (base: Partial<Parameters<typeof resolveClasses>[2]> = {}) => ({
  systemPropNames: ['p'],
  ...base,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('drop diagnostic', () => {
  test('static map hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-static1', { p: 8 }, config(), {
      p: { '8': 'animus-u-abc' },
    });
    expect(res.classes).toEqual(['animus-A-static1', 'animus-u-abc']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('dynamic slot hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-A-dyn1',
      { p: 12 },
      config(),
      undefined,
      { p: { varName: '--animus-p', slotClass: 'animus-dyn-p' } }
    );
    expect(res.classes).toEqual(['animus-A-dyn1', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '12px' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('unresolvable value warns with component, prop, and serialized value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-drop1', { p: 999 }, config());
    expect(res.classes).toEqual(['animus-A-drop1']);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('animus:drop');
    expect(msg).toContain('animus-A-drop1');
    expect(msg).toContain('p');
    expect(msg).toContain('999');
  });

  test('warns once per (component, prop) pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-once1', { p: 1 }, config());
    resolveClasses('animus-A-once1', { p: 2 }, config());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('production mode emits no warning', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-prod1', { p: 999 }, config());
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bunx vp test run packages/system/__tests__/drop-diagnostic.test.ts`
Expected: the two "no warning" precedence tests PASS (current behavior); the three
diagnostic tests FAIL (`warn` never called / message missing) — confirming the drop is
currently silent.

### Task 2: Implement the diagnostic

**Files:**
- Modify: `packages/system/src/runtime/resolveClasses.ts` (fall-through branch, ~line 215)

- [x] **Step 1: Add the helper above `resolveClasses`**

```ts
const warnedDrops = new Set<string>();

function warnDroppedValue(
  baseClassName: string,
  propName: string,
  serializedValue: string
): void {
  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'production'
  ) {
    const dedupeKey = `${baseClassName}|${propName}`;
    if (warnedDrops.has(dedupeKey)) return;
    warnedDrops.add(dedupeKey);
    // oxlint-disable-next-line no-console -- intentional runtime diagnostic
    console.warn(
      `[animus:drop] ${baseClassName}: value ${serializedValue} on prop '${propName}' matched no static class and no dynamic slot — it will not render. ` +
        `If this prop should accept runtime values, ensure its dynamic config is emitted.`
    );
  }
}
```

- [x] **Step 2: Call it from the fall-through**

In the system-prop loop, extend the existing `if (dc) { ... }` with:

```ts
        } else {
          warnDroppedValue(baseClassName, propName, key);
        }
```

(`key` is the already-computed `serializeValueKey(propValue)`; lookup order and all
existing branches are byte-for-byte unchanged — that is the D4 invariant.)

- [x] **Step 3: Run the test file**

Run: `bunx vp test run packages/system/__tests__/drop-diagnostic.test.ts`
Expected: all 5 tests PASS.

### Task 3: Tier verification (logical checkpoint)

- [x] **Step 1: Compile + types + unit tiers**

Run: `vp run verify:compile && vp run verify:types && vp run verify:unit:ts`
Expected: all three PASS (any `ERROR: X missing. Run: Y` message means a stale upstream
artifact — run the named command and retry; tiers never rebuild upstream themselves).

- [x] **Step 2: Guardrail G4 (v1 frozen)**

Run: `git diff --name-only HEAD -- packages/extract/src/`
Expected: empty output.

- [x] **Step 3: Guardrail G3 (prod stripping) — optional here, mandatory before tick**

Run: `vp run verify:build:showcase && rg -l "animus:drop" packages/showcase/dist/`
Expected: build succeeds; `rg` prints nothing and exits 1 (no match in any prod bundle).

## Output contract

- `resolveClasses.ts` contains `warnDroppedValue` with the `animus:drop` token, dev-gated,
  deduped per `(baseClassName, prop)`; the only structural change to `resolveClasses` is
  the added `else` branch.
- `drop-diagnostic.test.ts` passes; `verify:compile`, `verify:types`, `verify:unit:ts`
  pass; G3 and G4 checks pass as specified above.
- Journal note at tick: initial dedup policy (once per component+prop) recorded as
  provisional under DEF-2; dogfood observations from showcase dev feed DEF-2's resolution.
