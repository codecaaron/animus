## 1. Extraction — ComposeFamilyInfo

- [ ] 1.1 Define `ComposeFamilyInfo` struct in `jsx_scanner.rs`: root_binding, slots Vec<(String, String)>, shared_keys Vec<String>
- [ ] 1.2 Extend `extract_compose_bindings` to parse second argument (options object) and extract `shared` keys
- [ ] 1.3 Change `scan_compose_calls` return type from `HashSet<String>` to `Vec<ComposeFamilyInfo>` (callers still get binding names from the struct)
- [ ] 1.4 Add tests: family extraction with multiple slots, shared keys, multiple compose calls per file

## 2. Extraction — Composed CSS emission

- [ ] 2.1 Add composed variant emission function to `css_generator.rs` — accepts root class, child class, child variant declarations, emits Rule 1 (inheritance) and Rule 2 (override)
- [ ] 2.2 Verify specificity contract: both rules (0,3,0) — three class selectors each
- [ ] 2.3 Verify source ordering: inheritance rule emitted before override rule
- [ ] 2.4 Emit composed rules within `@layer variants` alongside direct variant rules
- [ ] 2.5 Add tests: two-rule emission, specificity check, source order, multiple shared variants, multiple children

## 3. Pipeline threading — project_analyzer

- [ ] 3.1 Thread `Vec<ComposeFamilyInfo>` from scan phase into reconciler phase
- [ ] 3.2 Update reconciler: for each family, mark shared variant options on child slots as "used" (prevent pruning)
- [ ] 3.3 Thread family info into css_generator phase: for each family, for each shared key, for each child with that variant, call composed emission
- [ ] 3.4 Update `project_analyzer.rs` compose binding marking to use new `ComposeFamilyInfo` struct (backward compat — still marks bindings as rendered)

## 4. Runtime — compose.ts simplification

- [ ] 4.1 Remove `createContext`, `FamilyContext`, `useContext`, `EMPTY_SHARED` from compose.ts
- [ ] 4.2 Remove `__variantKeys` filtering logic from child wrappers
- [ ] 4.3 Remove shared prop extraction from Root wrapper (Root just renders with its own variant classes)
- [ ] 4.4 Preserve sealing behavior (no `.extend()`) and displayName assignment
- [ ] 4.5 Preserve Root convention guard (`throw` if no "Root" key)

## 5. Type cleanup

- [ ] 5.1 Remove context-related types from `component.ts` if any exist
- [ ] 5.2 Verify `ComposedFamily`, `SharedConfig`, `AnyBrandedComponent` types unchanged
- [ ] 5.3 Verify type tests for compose-related assertions still pass

## 6. Integration tests

- [ ] 6.1 Update `_integration/fixtures/components/composition.tsx` — verify composed family still works without context
- [ ] 6.2 Add fixture: composed family with Ark/Radix-style `.asComponent()` wrapping
- [ ] 6.3 Add canary test: composed variant CSS contains both inheritance and override rules with correct selectors
- [ ] 6.4 Add canary test: standalone variant CSS unchanged for components not in a family
- [ ] 6.5 Add canary test: child-only-in-compose usage — direct variant classes pruned, composed rules preserved

## 7. Verification

- [ ] 7.1 Run `bun run test:canary` — Rust extraction canary suite
- [ ] 7.2 Run `bun run verify` — full TS pipeline
- [ ] 7.3 Run `bun run verify:showcase` — showcase builds with any composed families
- [ ] 7.4 Verify compose() API signature unchanged — no breaking changes
