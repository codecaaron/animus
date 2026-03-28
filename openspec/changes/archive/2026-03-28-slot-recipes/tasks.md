## 1. Type Infrastructure

- [x] 1.1 Add `VariantPropsOf<C>` utility type — extracts variant prop types from an `AnimusComponent` generic. Location: `packages/system/src/types/component.ts`
- [x] 1.2 Add `SharedVariantKeys<Slots>` type — intersection of variant key names across all slot components. Only keys present on ALL slots are valid
- [ ] 1.3 Add `VariantValuesMatch<Slots, Key>` constraint type — asserts that for a given shared key, the variant value union is identical across all slots (deferred — SharedVariantKeys enforces key presence; value matching deferred to avoid TSC complexity)
- [x] 1.4 Add `ComposedSlot<C, Shared>` type — sealed component type (ForwardRefExoticComponent, no extend). Omits shared keys from child slot props
- [x] 1.5 Add `ComposedRoot<C, Shared>` type — sealed component type that KEEPS shared keys (Root is the provider)
- [x] 1.6 Add `ComposedFamily<Slots, Shared>` type — record mapping slot names to composed slot types, with Root special-cased
- [x] 1.7 Type regression tests in `types.test-d.tsx` — valid compose calls accepted, missing shared keys rejected, output has no `.extend()`

## 2. Runtime Implementation

- [x] 2.1 Create `packages/system/src/compose.ts` — the `compose()` function
- [x] 2.2 Create family context via `createContext` — stores shared variant prop values as `Record<string, unknown>`
- [x] 2.3 Generate Root wrapper — `forwardRef` component that provides shared values to context AND passes them to original Root component for its own variant resolution
- [x] 2.4 Generate child wrappers — `forwardRef` components that read shared values from context, merge with direct props (direct wins), forward to original component
- [x] 2.5 Assign `displayName` to each composed slot — `'FamilyName.SlotName'` pattern (derive family name from Root component's displayName or fall back to 'Composed')
- [x] 2.6 Return sealed record — capitalized keys, plain ForwardRefExoticComponent (no AnimusComponent methods)
- [x] 2.7 Export `compose` from `packages/system/src/index.ts`

## 3. Unit Tests

- [x] 3.1 Test: composed Root provides shared variant values to children via context
- [x] 3.2 Test: child slots receive shared variant values and apply correct variant classes
- [x] 3.3 Test: direct prop on child slot overrides context value
- [x] 3.4 Test: non-shared variant props are NOT propagated through context
- [x] 3.5 Test: consumer className merges correctly on composed slots
- [x] 3.6 Test: composed output has no `.extend()` method (sealed)
- [ ] 3.7 Test: ref forwarding works on all composed slots (skipped — renderToString doesn't exercise refs)
- [x] 3.8 Test: empty shared list produces namespaced family without context

## 4. Showcase Verification

- [x] 4.1 Create a multi-slot showcase component using `compose()` — Card with Root, Header, Body, Footer slots sharing a `density` variant
- [x] 4.2 Verify extraction works — each slot appears in CSS output with correct classes (15 classes: 4 base + 8 density + 3 variant)
- [x] 4.3 Add live demo to Concepts page — density toggle switches all slots, 3-column card grid
- [x] 4.4 Run `bun test` — 255 tests pass, 131 canary tests pass
- [x] 4.5 Showcase builds — no Card elimination warnings, CSS includes all slot classes

## 5. Extraction Pipeline (added during implementation)

- [x] 5.1 Add `scan_compose_calls()` to `jsx_scanner.rs` — detects compose() calls, extracts slot binding names from first argument
- [x] 5.2 Integrate in `project_analyzer.rs` — compose slot bindings marked as rendered in usage ledger (same pattern as .asClass())
