## 1. Setup

- [x] 1.1 Create `docs/` directory if it doesn't exist
- [x] 1.2 Create `docs/v1-faq.md` with document skeleton (all 7 H2 section headers)

## 2. Positioning & Mental Model

- [x] 2.1 Write "What Is This" section (3 sentences max: what it is, what it produces, what it requires)
- [x] 2.2 Write "How It Works" section (5-bullet mental model: builder chain → extraction → cascade layers → zero-runtime → graceful degradation)

## 3. Common Misconceptions

- [x] 3.1 Write misconception entry: token ref opacity (Claim: dead code in createTheme.ts → Truth: Rust crate theme_resolver → Verify: grep pattern)
- [x] 3.2 Write misconception entry: includes() no-op (Claim: runtime bug → Truth: AST marker for extractSystemFilePackages → Verify: function reference)
- [x] 3.3 Write misconception entry: module augmentation (Claim: unusual pattern → Truth: industry standard, same as Emotion/styled-components → Verify: TS docs link)
- [x] 3.4 Write misconception entry: zero-runtime definition (Claim: misleading → Truth: no style computation at render, 129-line runtime is pure string lookup → Verify: runtime file reference)
- [x] 3.5 Write misconception entry: prop groups are framework defaults (Claim: animus ships 9 groups → Truth: 100% user-defined via .addGroup(), showcase groups are that app's choices → Verify: createSystem type signature)

## 4. Feature Matrix

- [x] 4.1 Build feature table covering: CSS variables, color modes, responsive props, token references, opacity modifiers, custom transforms, cascade layers, global styles, multi-slot composition, framework-agnostic output (.asClass()), Vite support, Next.js support, CSS variable prefixing, incremental HMR
- [x] 4.2 Verify each "Yes" entry has a concrete "How" value (builder method, pipeline step, or plugin feature name)

## 5. Known Limitations

- [x] 5.1 Document known constraints with status tags: single CSS file (planned), static-only values (known-constraint), compose() needs 'use client' (known-constraint), no standalone Webpack plugin (designing)
- [x] 5.2 Cross-reference `planned` tags against active openspec proposals to confirm accuracy

## 6. Adoption

- [x] 6.1 Write minimum Vite setup: `animusExtract({ system: './src/ds.ts' })` + `import 'virtual:animus/styles.css'`
- [x] 6.2 Write minimum Next.js setup: `withAnimus({ system: './src/ds.ts' })({})` + `import '.animus/styles.css'`
- [x] 6.3 Write module augmentation pattern (declare module + interface extends)
- [x] 6.4 Brief note on incremental adoption (one component at a time, works alongside existing CSS)

## 7. Proof Points & Finalization

- [x] 7.1 Build consolidated Proof Points index: all verify paths grouped by package (system, extract, vite-plugin, next-plugin)
- [x] 7.2 Add RFC.md cross-references (link to relevant sections, never duplicate)
- [x] 7.3 Final review: confirm no line-number references (functions only), no RFC duplication, all claims verifiable
