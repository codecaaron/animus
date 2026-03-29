## Context

`ThemedCSSProps` is the mapped type that determines what values are allowed at each key position in style objects passed to `.styles()`, `.variant()`, and `.states()`. It uses a three-branch conditional type: system prop keys get themed scale values, CSS property keys get standard CSS types, and everything else gets the fallback branch.

Core's `CSSProps` type (line 97-103 of `core/src/types/config.ts`) set the fallback to `Omit<PropertyTypes, keyof System> & Omit<System, 'theme'>` — an intersection that re-exposes the full type vocabulary for unknown keys (nested selectors, CSS variables, etc.). When `ThemedCSSProps` was created for the system package to use augmentable `Theme` instead of generic `T`, this re-provisioning was replaced with `unknown`.

## Goals / Non-Goals

**Goals:**
- Restore type awareness inside nested selector blocks to parity with core's `CSSProps`
- Add regression test that fails at compile time if the fallback branch becomes `unknown` again
- Cover `.styles()`, `.variant()`, and `.states()` nested selector paths

**Non-Goals:**
- Recursive type checking inside nested selectors (selectors within selectors) — out of scope, same as core
- Typed selector shorthand expansion (that's `selector-registry` change)
- Changes to `CSSObject` definition or `PropertyTypes`

## Decisions

### 1. Fallback type mirrors core's pattern

**Decision**: `Omit<PropertyTypes, keyof Config> & { [P in keyof Config]?: ThemedScale<Config[P]> }`

**Rationale**: Direct translation of core's `Omit<PropertyTypes, keyof System> & Omit<System, 'theme'>` into the themed type system. `Config` replaces `System`, `ThemedScale<Config[P]>` replaces `System[K]`, no `theme` key to omit.

### 2. Type-level negative assertion using `unknown extends T` check

**Decision**: `type _NestedNotUnknown = Assert<unknown extends ResolvedNested['&:hover'] ? false : true>`

**Rationale**: `unknown extends T` evaluates to `true` ONLY when `T` is `unknown`. If the fallback regresses, the Assert receives `false` and the file fails to compile. This tests the type mechanism directly at the `ThemedCSSProps` level without needing to extract types through the chain's generic inference.

### 3. Test at ThemedCSSProps level, not chain level

**Decision**: Import `ThemedCSSProps` and `Prop` directly, construct test types, assert on the resolved mapped type.

**Rationale**: The chain method's generic inference makes type extraction awkward. Testing `ThemedCSSProps` directly isolates the exact regression point. Positive usage assertions (`.styles()`, `.variant()`, `.states()` with nested selectors) confirm the fix propagates through the chain.

## Risks / Trade-offs

**[Acceptable] Permissive fallback for misspelled props**: A key like `'colr'` (typo) gets the full vocabulary instead of an error. This matches core's behavior — the tradeoff is deliberate: support open-ended CSS selectors at the cost of no error on non-selector typos. CSS-in-JS has always made this tradeoff.
