## 1. Rust: Unknown Chain Method Bail

- [x] 1.1 In `chain_walker.rs`, add an `else` branch after the `CHAIN_METHODS`/`BAIL_METHODS` checks: if method is not in either set, set `extractable = false` with bail reason `"unknown chain method: {name}"`
- [x] 1.2 Add Rust unit tests: `bails_on_unknown_method` (chain with `.unknownMethod()`) and `bails_on_unknown_method_in_extension` (extension chain with unknown method)
- [x] 1.3 Add integration test in `canary.test.ts`: source with unknown method → extraction bails, component not in manifest

## 2. Rust: Dead Import Stripping

- [x] 2.1 In `transform_emitter.rs`, extend `apply_replacements` to accept a set of consumed import sources (e.g., `@animus-ui/core`) and the set of extracted binding names
- [x] 2.2 Before applying replacements, scan the source for `import { ... } from 'consumed-source'` statements. If ALL named bindings from the import are in the extracted bindings set, add a replacement that removes the entire import line
- [x] 2.3 Add Rust unit test: `strips_dead_import_when_all_bindings_extracted` and `preserves_import_when_partial_bindings`
- [x] 2.4 Add integration test in `canary.test.ts`: transformed output should NOT contain `import { animus }` when all chains from that import are extracted

## 3. Smoke Test: TypeScript Configuration

- [x] 3.1 Create `packages/smoke-test/tsconfig.json` extending root with `jsx: "react-jsx"`, `noEmit: true`, `paths` for `@animus-ui/core` and `@animus-ui/runtime` pointing to source directories
- [x] 3.2 Add `"typecheck": "tsc --noEmit"` script to `packages/smoke-test/package.json`
- [x] 3.3 Run `bun run typecheck` and fix any type errors in existing smoke test source
- [x] 3.4 Verify that introducing an intentional type error (e.g., `variant="typo"`) causes tsc to fail, then revert

## 4. Smoke Test: .asComponent() Coverage

- [x] 4.1 Add a simple wrapper component to smoke test (e.g., `const Wrapper: React.FC<{ className?: string; children?: React.ReactNode }> = (props) => <div {...props} />`)
- [x] 4.2 Add a builder chain using `.asComponent(Wrapper)` in `components.tsx`
- [x] 4.3 Use the new component in `App.tsx` with styling props
- [x] 4.4 Verify extraction works: `bun run build` succeeds, component appears in manifest, rendered output applies className

## 5. Cleanup

- [x] 5.1 Archive or update the `typescript-type-preservation` proposal to reflect that generic `createComponent` is unnecessary
- [x] 5.2 Update `project_next_proposals.md` memory to mark "unknown chain method bail" as done and rescope "TypeScript type preservation" to "source-level type verification"
