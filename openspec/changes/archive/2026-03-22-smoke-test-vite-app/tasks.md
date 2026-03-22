## 1. Package Setup

- [ ] 1.1 Create `packages/smoke-test/package.json` with react, react-dom, vite, @vitejs/plugin-react
- [ ] 1.2 Create `packages/smoke-test/index.html` with root div and module script entry
- [ ] 1.3 Create `packages/smoke-test/tsconfig.json` with JSX react-jsx transform
- [ ] 1.4 Run `bun install` in the smoke test package

## 2. Components

- [ ] 2.1 Create `src/components.tsx` with Box (styles + states + groups), Text (styles + variant with as prop + groups), Button (styles + variant with defaultVariant + states + pseudo-selectors), FlexBox (styles + states + groups)
- [ ] 2.2 Create `src/App.tsx` exercising all components: system props (p, color, gap), variants (primary/secondary/ghost), states (disabled), responsive values (p={{ _: 16, sm: 32 }})
- [ ] 2.3 Create `src/main.tsx` React entry point

## 3. Vite Config + Extraction Plugin

- [ ] 3.1 Create `vite.config.ts` with react plugin + inline extraction plugin
- [ ] 3.2 Inline plugin: load NAPI addon via relative path to ../extract/index.js
- [ ] 3.3 Inline plugin: load serialized config via Bun subprocess evaluating serialize-config.ts
- [ ] 3.4 Inline plugin: define static theme JSON with hardcoded values (no CSS variables)
- [ ] 3.5 Inline plugin: implement buildStart (file discovery + analyzeProject), transform (transformFile), resolveId/load (virtual CSS module)
- [ ] 3.6 Configure resolve.alias for @animus-ui/core and @animus-ui/runtime

## 4. Build Verification

- [ ] 4.1 Run `vite build` — verify it completes without errors
- [ ] 4.2 Inspect dist/ CSS output — verify @layer structure, component classes, utility classes, @media queries
- [ ] 4.3 Inspect dist/ JS output — verify createComponent calls, no animus.styles chains
- [ ] 4.4 Run `vite preview` — verify app renders with visible styling
- [ ] 4.5 Document any issues found and fixes applied
