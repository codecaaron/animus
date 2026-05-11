## 1. Type System

- [x] 1.1 Add `context?: boolean` to compose options type in `packages/system/src/types/component.ts`
- [x] 1.2 Add type test: `context: true` accepted, `context: 'yes'` rejected (ts-expect-error)

## 2. Runtime — compose.ts

- [x] 2.1 Add conditional context creation: when `context: true`, create FamilyContext via createContext, build sharedKeySet from `options.shared`
- [x] 2.2 Root wrapper (context mode): extract shared prop values from Root's props, render Provider wrapping `props.children` inside Root's output
- [x] 2.3 Child wrapper (context mode): useContext(FamilyContext), merge context under direct props (`{ ...context, ...props }`)
- [x] 2.4 Default branch unchanged: when `context` is false/absent, existing thin forwardRef wrapper — no hooks, no context

## 3. Runtime Tests

- [x] 3.1 Test: `context: true` family — Root renders Provider, child receives shared prop values from context
- [x] 3.2 Test: `context: true` family — direct props on child override context-provided values
- [x] 3.3 Test: default family (no `context`) — no Provider rendered, no useContext called (existing behavior preserved)

## 4. Extraction — jsx_scanner.rs

- [x] 4.1 Add `context: bool` field to `ComposeFamilyInfo` struct
- [x] 4.2 Extract `context: true/false` from compose options AST in `extract_compose_family` (mirror `extract_shared_keys` pattern — look for `context` property, check for boolean `true` literal)
- [x] 4.3 Default `context` to `false` when property is absent
- [x] 4.4 Add scanner tests: compose with `context: true` extracted, compose without `context` defaults to false, compose with `context: false` extracted as false

## 5. Extraction — transform_emitter.rs

- [x] 5.1 Add `needs_use_client: bool` parameter to `apply_replacements`
- [x] 5.2 Extend directive handling block: when `needs_use_client` is true AND source lacks `"use client"` directive, inject `'use client';\n` before import lines
- [x] 5.3 Preserve existing behavior: when source already has directive, no duplicate injection regardless of `needs_use_client`
- [x] 5.4 Add emitter tests: directive injected when absent + needed, directive preserved when already present, no injection when `needs_use_client` is false

## 6. Pipeline Threading — project_analyzer.rs

- [x] 6.1 Thread `context` field from `ComposeFamilyInfo` through to transform manifest: determine `needs_use_client` per file (true if ANY compose family in file has `context: true`)
- [x] 6.2 Pass `needs_use_client` to `apply_replacements` call site

## 7. Canary Tests

- [x] 7.1 Canary test: compose with `context: true` — ComposeFamilyInfo has `context: true`, CSS emission unchanged
- [x] 7.2 Canary test: `"use client"` injection — source without directive + `context: true` family produces output with `'use client';` at top
- [x] 7.3 Canary test: `"use client"` preservation — source with existing directive + `context: true` family preserves single directive (no duplicate)

## 8. Documentation

- [x] 8.1 Update `packages/showcase/src/content/authoring/composition.md` — add section on `context: true` for portal-mounted slots
