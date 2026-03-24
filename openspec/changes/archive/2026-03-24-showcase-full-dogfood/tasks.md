## 1. Keyframes in Global Styles

- [x] 1.1 Add `@keyframes ember` and `@keyframes tally-pulse` definitions to `.withGlobalStyles({ global: {...} })` in `ds.ts`
- [x] 1.2 Add `pre[style]` override to global styles block for prism-react-renderer border override
- [x] 1.3 Add `3` key to borders scale in theme (`3: '3px solid currentColor'`) for StratumRow

## 2. Animation as System Prop

- [x] 2.1 Add `motion: true` to Display component's `.groups()` call to expose `animation` prop
- [x] 2.2 Replace all `className="ember-glow"` with `animation="ember 3s ease-in-out infinite"` in App.tsx
- [x] 2.3 Replace all `className="ember-glow tally-number"` with combined animation shorthand in App.tsx

## 3. CSS File Elimination

- [x] 3.1 Remove `import './global.css'` from `main.tsx`
- [x] 3.2 Delete `src/global.css`
- [x] 3.3 Delete `src/reset.css` (already superseded by `.withGlobalStyles()`, never imported)

## 4. Documentation Fix

- [x] 4.1 Fix DEFINE_EXAMPLE variant syntax: `.variant('elevation', {...})` → `.variant({ prop: 'elevation', variants: {...} })`

## 5. Verification

- [x] 5.1 Showcase builds successfully with zero CSS file imports
- [x] 5.2 Keyframes appear in `@layer global` block in built CSS
- [x] 5.3 Animation system props extracted as utility classes (`.animus-u-*`)
- [x] 5.4 No `ember-glow`, `tally-number`, or `global.css` references in JS bundle
