## 1. Sync Specs to Main Spec Directory

- [x] 1.1 Copy `builder-chain/spec.md` to `openspec/specs/builder-chain/spec.md` as the canonical spec
- [x] 1.2 Copy `extension-system/spec.md` to `openspec/specs/extension-system/spec.md` as the canonical spec
- [x] 1.3 Copy `prop-system/spec.md` to `openspec/specs/prop-system/spec.md` as the canonical spec

## 2. Validate Specs Against Implementation

- [x] 2.1 Trace each builder-chain scenario against `Animus.ts` to verify spec matches behavior
- [x] 2.2 Trace each extension-system scenario against `AnimusExtended.ts` to verify merge semantics and ordering
- [x] 2.3 Trace each prop-system scenario against `createParser.ts`, `createPropertyStyle.ts`, and `config.ts`
- [x] 2.4 Verify responsive value scenarios against `styles/responsive.ts`
- [x] 2.5 Verify prop ordering scenarios against `properties/orderPropNames.ts`

## 3. Update Package-Level CLAUDE.md

- [x] 3.1 Update `packages/core/CLAUDE.md` to reference the canonical specs as the authoritative behavioral contract
- [x] 3.2 Remove or consolidate redundant architectural documentation that is now covered by specs

## 4. Identify Gaps and Edge Cases

- [x] 4.1 Review existing tests in `__tests__/createAnimus.test.ts` and map coverage to spec scenarios
- [x] 4.2 Document any spec scenarios that lack corresponding tests (candidates for future test additions)
- [x] 4.3 Review `_integration/__tests__/` for additional behavioral coverage not captured in specs

### Gap Analysis Notes

**Coverage mapping (createAnimus.test.ts → spec scenarios):**
- builder-chain: "Valid chain produces typed component" → COVERED (full chain exercised)
- builder-chain: "Variant types accumulate across multiple calls" → COVERED (3 separate .variant() calls)
- builder-chain: "State styles override variant styles" → COVERED (woah + dude states with variant foo)
- builder-chain: "System props override declarative styles" → COVERED (p='initial' overrides base)
- prop-system: "Array responsive syntax" → COVERED (pl: ['4', '8', '12'] in states)
- prop-system: "Object responsive syntax" → COVERED (m: { _: '4px', sm: '8px', xl: '12px' })
- prop-system: "Responsive values in style definitions" → COVERED (base m uses object syntax)

**Integration tests (variance.test.ts) add coverage for:**
- Array/object responsive syntax equivalence (parameterized test)
- Scale resolution from theme
- Custom transform functions
- Variant default values
- State merging order

**Scenarios WITHOUT direct test coverage (candidates for future tests):**
- builder-chain: "Invalid ordering is a compile error" — type-level test needed (currently only enforced by TS compiler)
- builder-chain: "Methods are optional with skip-through" — no test exercises skipping all middle methods
- extension-system: "Merge is immutable" — no test verifies parent instance unchanged after extend()
- extension-system: "Deep extension chains maintain topological order" — no multi-level extend() test
- prop-system: "Value not in scale passes through" — covered implicitly but not explicitly tested
- prop-system: "Shorthand before longhand" — orderPropNames.test.ts covers this separately
