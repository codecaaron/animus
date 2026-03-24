## 1. Build Scripts

- [x] 1.1 Add `clean:light` script to root package.json: `rm -rf node_modules/.vite packages/*/dist`
- [x] 1.2 Add `clean:full` script to root package.json: `rm -rf node_modules/.vite packages/*/dist packages/extract/target packages/extract/*.node`
- [x] 1.3 Add `rebuild` script to root package.json: `bun run clean:full && bun run build:all`
- [x] 1.4 Update `verify:full` to include showcase build after existing checks
- [x] 1.5 Add `verify:showcase` script: `bun run build:all && bun run --filter './packages/showcase' build`

## 2. Extract Package CLAUDE.md

- [x] 2.1 Create `packages/extract/CLAUDE.md` with: crate overview, NAPI function signatures (`extract`, `analyze_project`, `transform_file`), build commands, cache locations (`target/`, `*.node`), known failure modes (stale binary after sig change)

## 3. Vite Plugin CLAUDE.md

- [x] 3.1 Create `packages/vite-plugin/CLAUDE.md` with: plugin lifecycle hooks (`buildStart`, `resolveId`/`load`, `transform`), subprocess model (system loading, global styles resolution), Vite cache behavior (`node_modules/.vite/`), known failure modes (resolve aliases, stale cache), debug logging

## 4. Showcase CLAUDE.md

- [x] 4.1 Create `packages/showcase/CLAUDE.md` with: role as extraction proof, design system in `src/ds.ts`, components in `src/components.tsx`, verification procedure, expected bundle characteristics (no Emotion, static CSS), common breakage patterns

## 5. Root CLAUDE.md Addendum

- [x] 5.1 Append build system section to root `CLAUDE.md`: package build order, verification loop (`verify` vs `verify:full` vs `rebuild`), cache tiers, debugging decision tree
