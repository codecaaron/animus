## 1. Root convention — strict key matching

- [x] 1.1 Update `compose.ts` Root detection from `name.toLowerCase() === 'root'` to `name === 'Root'`
- [x] 1.2 Remove `rootSlot` fallback that checks both `slots.Root` and `slots.root`
- [x] 1.3 Update `RootSlot` type in `component.ts` from `Lowercase<K & string> extends 'root'` to direct `'Root' extends keyof Slots ? Slots['Root'] : never`
- [x] 1.4 Update integration test fixture (`composition.tsx`) from lowercase `root`/`child` keys to `Root`/`Child`

## 2. Family displayName derivation

- [x] 2.1 Add optional `name` field to compose options type: `{ shared: Shared; name?: string }`
- [x] 2.2 Replace `rootSlot.displayName.replace(/[-_].*$/, '')` with: use `options.name` if provided, else strip `animus-` prefix and trailing `-hash` from Root displayName, else `'Composed'`
- [x] 2.3 Add test case for explicit family name via options
- [x] 2.4 Add test case for displayName fallback when no name option provided

## 3. Key preservation verification

- [x] 3.1 Add integration test: render a list of composed Root components with React keys, verify reconciliation identity
- [x] 3.2 Verify forwardRef wrapper propagates keys correctly in existing test harness

## 4. Type cleanup

- [x] 4.1 Remove deprecated `SharedVariantKeys` type from `component.ts` (and from `index.ts` export)
- [x] 4.2 Simplify `RootSlot` to use the new direct lookup (done in 1.3)
- [x] 4.3 Remove `Capitalize<K>` transform from `ComposedFamily` — slot keys pass through directly
- [x] 4.4 Remove orphaned `AllVariantKeys` type (only consumer was `SharedVariantKeys`)
- [x] 4.5 Verify type tests in `types.test-d.tsx` for compose-related assertions still pass

## 5. Integration and extraction verification

- [x] 5.1 Update `_integration/fixtures/components/composition.tsx` Root key convention
- [x] 5.2 Run composition integration tests — verify slot CSS and shared variant propagation
- [x] 5.3 Run full canary suite — verify Rust extractor still handles compose correctly
- [x] 5.4 Run `bun run verify` — full pipeline clean

## 6. Dev-mode Root guard (from 3rd-party review)

- [x] 6.1 After slot loop, throw if `"Root"` key not in result (dev mode only) — prevents silent failure when lowercase `root` is passed post-migration
