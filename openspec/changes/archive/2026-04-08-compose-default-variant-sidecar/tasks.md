## 1. CSS Generator — Sidecar Rule Emission

- [ ] 1.1 In `css_generator.rs`, emit a `--{prop}-default` sidecar rule when a variant has `defaultVariant`. The sidecar duplicates the default option's declarations (including pseudo-selectors and responsive) as a standalone class rule within `@layer variants`.
- [ ] 1.2 The sidecar rule must appear alongside normal variant option rules, not inside compose rule output. It's a property of the component, not the family.

## 2. Runtime — Default Class Resolution

- [ ] 2.1 In `resolveClasses.ts`, change the variant class emission to use `--{prop}-default` when the value comes from `vc.default` fallback (prop not in props), and `--{prop}-{value}` when the prop is explicitly passed.
- [ ] 2.2 Verify compound variant resolution (`resolveClasses.ts:131-149`) still uses the correct VALUE (not class name) for condition matching — no change needed, but confirm.

## 3. Canary Tests

- [ ] 3.1 Add canary test: variant with `defaultVariant` emits sidecar `--{prop}-default` CSS rule with correct declarations.
- [ ] 3.2 Add canary test: compose family with `defaultVariant` on child — inheritance rule at (0,3,0) beats sidecar at (0,1,0). Verify composed CSS output includes both compose rules AND sidecar.
- [ ] 3.3 Update existing compose canary test assertions if class name patterns change in snapshots.

## 4. Showcase Verification

- [ ] 4.1 Add `defaultVariant: 'comfortable'` to Card child slots (CardHeader, CardBody, CardFooter) and verify compose inheritance works in dev server — parent `density="compact"` overrides child defaults.
- [ ] 4.2 Verify standalone Card children render correctly with `--density-default` class.
- [ ] 4.3 Run `bun run verify:showcase` — full pipeline proof.
