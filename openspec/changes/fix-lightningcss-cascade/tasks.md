# Tasks: fix-lightningcss-cascade

## assembleStylesheet split return

- [ ] Add `split?: boolean` option to `AssembleStylesheetOptions` in `packages/extract/pipeline/assemble-stylesheet.ts`
- [ ] Implement overloaded return: when `split: true`, return `{ declaration: string, body: string }` where declaration = layer statement + variableCss, body = globalCss + componentCss
- [ ] Default (no split) continues returning a single concatenated string for backward compatibility

## Vite plugin load hook — prod mode

- [ ] In `load` hook prod path (line ~742), call `assembleStylesheet` with `split: true`
- [ ] Run `postProcessCss` on `body` only
- [ ] Concatenate: `declaration + '\n' + processedBody` as the return value
- [ ] Verify: showcase prod build output starts with full `@layer` declaration, `:root` variables before layer blocks

## Vite plugin load hook — dev mode

- [ ] In `load` hook dev path (line ~728), call `assembleStylesheet` with `split: true`
- [ ] Run `postProcessCss` on `body` only (global CSS)
- [ ] Concatenate: `declaration + '\n' + processedBody`

## Vite plugin adopted stylesheet — dev HMR bridge

- [ ] In `RESOLVED_COMPONENTS_ID` load path (line ~752), strip `sheets.declaration` from `resolvedComponentCss` before passing to `postProcessCss`
- [ ] Use `stripLeadingLayerDeclaration` (already exists in assemble-stylesheet.ts) or equivalent

## Verification

- [ ] Build showcase: verify `@layer reset, anm-global, ..., overrides;` appears as first statement in output CSS
- [ ] Build showcase: verify `:root` variables appear between declaration and first `@layer` block
- [ ] Run `bun test` — all JS tests pass
- [ ] Run `bun run test:canary` — canary tests pass
- [ ] Dev mode: verify virtual module CSS has correct ordering in browser devtools
