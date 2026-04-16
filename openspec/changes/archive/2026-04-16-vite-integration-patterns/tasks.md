# Tasks: vite-integration-patterns

## High-priority audits

- [ ] **Tailwind layer collision**: Build blockworks os-admin, inspect output CSS for `@layer base` from both Tailwind and consumer config. Determine if layers merge. Check if `validateLayerOrder` should warn.
- [ ] **Plugin ordering**: Test `animusExtract()` before and after `reactRouter()` in blockworks. Check virtual module resolution, transform hook order, CSS import processing.
- [ ] **CSS-in-JS coexistence**: Find an element styled by both Emotion (Chakra) and Animus in blockworks. Inspect cascade behavior in devtools. Document the model.

## Medium-priority audits

- [ ] **optimizeDeps interaction**: Check if `@animus-ui/system` in `optimizeDeps.include` affects `loadSystemModule()`. Test with and without.
- [ ] **build.cssMinify interaction**: Build blockworks with `cssMinify: true` (currently false). Check if double-processing (our Lightning CSS + Vite's esbuild) corrupts output.
- [ ] **Monorepo workspace packages**: Check if `@blockworks/ui-kit` contains Animus components. If so, verify they're discovered by the extraction pipeline.

## Lower-priority audits

- [ ] **CSS Modules coexistence**: Create a minimal test with `.module.css` alongside extracted CSS. Verify no `@layer` interference.
- [ ] **Library mode**: Configure showcase as `build.lib`, build, and check output structure + CSS delivery.
- [ ] **SSR handling**: Enable SSR in showcase (or minimal reproduction), check virtual module behavior during SSR.

## Output

- [ ] Produce compatibility matrix table: Pattern × Status × Evidence × Action
- [ ] Create follow-up change proposals for any pattern marked "fix"
- [ ] Update vite-plugin CLAUDE.md with documented integration patterns
