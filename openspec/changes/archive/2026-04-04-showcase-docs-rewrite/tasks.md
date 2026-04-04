## 1. Story Validation

- [ ] 1.1 Walk `packages/system/src/index.ts` exports — confirm every public API maps to at least one story in the inventory
- [ ] 1.2 Identify orphaned exports (types, internal utilities) that belong in reference appendix only
- [ ] 1.3 Finalize RC minimum story set (1-15) vs post-RC (16-23)

## 2. Guided Pages — RC Minimum

- [ ] 2.1 Rewrite Getting Started (stories 1-3): install, vite config, copy-paste `ds.ts` boilerplate (don't explain yet), first styled component, nested selectors for hover/focus, output CSS with `@layer base`. Include one sentence defining what CSS layers DO.
- [ ] 2.2 Write Variants & States (stories 4-6, 17): size+intent dual variant, compound conditions, boolean state props at `@layer states` priority, `.extend()` to build on existing component. Cascade comparison showing layer precedence.
- [ ] 2.3 Write System Props (stories 7-8): `.system()` with pre-built groups, responsive breakpoint objects, shared utility class output
- [ ] 2.4 Write Theming (stories 10-13): `createTheme()`, `addColors()`, `addColorModes()`, `addScale()`, token ref syntax `'{colors.primary}'` → `var(--color-primary)`
- [ ] 2.5 Write System Setup (stories 14-15): `createSystem().addGroup()` composing pre-built groups, `createGlobalStyles()` for reset/base styles. NOW explain the ds.ts boilerplate from Getting Started.
- [ ] 2.6 Write Composition (story 16): `compose()` for multi-slot families with shared variants, sealed output
- [ ] 2.7 Write TypeScript & Debugging (stories 18-19): autocomplete screenshots/descriptions, type errors for invalid tokens/variants, error paths for missing `.asElement()`, invalid token refs. Show the type system as product feature.

## 3. Reference Pages

- [ ] 3.1 Write Builder Chain Reference: all methods, signatures, layer mapping, one-line descriptions
- [ ] 3.2 Write createTheme Reference: all methods with signatures and parameter types
- [ ] 3.3 Write createSystem Reference: addGroup, addProps, includes, build — with signatures
- [ ] 3.4 Write compose Reference: signature, SharedConfig constraint, ComposedFamily output

## 4. Before/After Anchors

- [ ] 4.1 Create CSS → Animus translation for .styles() (Getting Started page)
- [ ] 4.2 Create CSS → Animus translation for variants (CSS class toggles → .variant())
- [ ] 4.3 Create CSS → Animus translation for theming (CSS custom properties → token refs)

## 5. Page Infrastructure

- [ ] 5.1 Update page routing if page names/structure changed
- [ ] 5.2 Remove stale content pages that don't map to new structure
- [ ] 5.3 Update navigation/sidebar to reflect new page hierarchy

## 6. Cascade Coherence

- [ ] 6.1 Verify each guided page explicitly names the `@layer` it introduces and anchors it to previously-seen layers
- [ ] 6.2 Verify cascade-first mental model is consistent across all pages (same CSS objects everywhere, layer position is the only difference)
- [ ] 6.3 Verify nested selectors in `.states()` work through extraction pipeline (write a test example if needed)

## 7. Verification

- [ ] 7.1 Grep all new content for `.groups(` — zero matches
- [ ] 7.2 Grep all new content for `.withProperties(` — zero matches
- [ ] 7.3 Grep all new content for `.withGlobalStyles(` — zero matches
- [ ] 7.4 Grep all new content for `animus.styles` — zero matches
- [ ] 7.5 Build showcase to verify markdown renders correctly
- [ ] 7.6 Review: each guided page leads with code, not prose
- [ ] 7.7 Review: states described as cascade priority, not CSS pseudo-classes
