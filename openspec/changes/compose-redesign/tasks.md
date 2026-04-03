## 1. Root convention — strict key matching

- [ ] 1.1 Update `compose.ts` Root detection from `name.toLowerCase() === 'root'` to `name === 'Root'`
- [ ] 1.2 Remove `rootSlot` fallback that checks both `slots.Root` and `slots.root` (line 40)
- [ ] 1.3 Update `RootSlot` type in `component.ts` from `Lowercase<K & string> extends 'root'` to direct `'Root' extends keyof Slots ? Slots['Root'] : never`
- [ ] 1.4 Update any integration test fixtures using lowercase `root` key to `Root`

## 2. Family displayName derivation

- [ ] 2.1 Add optional `name` field to compose options type: `{ shared: Shared; name?: string }`
- [ ] 2.2 Replace `rootSlot.displayName.replace(/[-_].*$/, '')` with: use `options.name` if provided, else strip `animus-` prefix and trailing `-hash` from Root displayName, else `'Composed'`
- [ ] 2.3 Add test case for explicit family name via options
- [ ] 2.4 Add test case for displayName fallback when no name option provided

## 3. Key preservation verification

- [ ] 3.1 Add integration test: render a list of composed Root components with React keys, verify reconciliation identity (reorder does not remount)
- [ ] 3.2 Verify forwardRef wrapper propagates keys correctly in existing test harness

## 4. Type cleanup

- [ ] 4.1 Remove deprecated `SharedVariantKeys` type from `component.ts` (replaced by `SharedConfig`)
- [ ] 4.2 Simplify `RootVariantKeys` to use the new direct `RootSlot` lookup
- [ ] 4.3 Verify type tests in `types.test-d.tsx` for compose-related assertions still pass

## 5. Integration and extraction verification

- [ ] 5.1 Update `_integration/fixtures/components/composition.tsx` Root key convention if needed
- [ ] 5.2 Run composition integration tests — verify slot CSS and shared variant propagation
- [ ] 5.3 Run full canary suite — verify Rust extractor still handles compose correctly
- [ ] 5.4 Run `bun run verify` — full pipeline clean
