import { createKeyframes } from './system';

export { Alert } from './components/Alert';
export { Badge } from './components/Badge';
export { Button } from './components/Button';
export { Card } from './components/Card';
export { ContainerCard } from './components/ContainerCard';
export { GroupItem } from './components/GroupItem';
// The side-effect-free `system` / `theme` pair lives at `./definition`.
// Root keeps the historical names beside the component exports.
export { ds } from './system';
export { referenceTokens } from './theme';

// Identifier-backed variant map (ani-015-root-issues,
// semantic-const-resolution): consumers reference this via a plain named
// import (`variants: kitSizes`) and the extraction-time statics resolver must
// produce the same manifest options and CSS as inlining the literal — the
// `as const` wrapper must be transparent to static evaluation. Values stay
// inside the kit token vocabulary (fontSizes 14/16/20, space 4/8/12/16/24).
export const kitSizes = {
  sm: { fontSize: 14, px: 8, py: 4 },
  md: { fontSize: 16, px: 16, py: 8 },
  lg: { fontSize: 20, px: 24, py: 12 },
} as const;

// External keyframe collection (ani-015-root-issues, rust-extraction-pipeline
// › external-collection scenario): exported from the package's source ENTRY
// module (what `main`/exports resolve to under src/), which the plugin's
// keyframes-only scan evaluates for `__brand === 'Keyframes'` named exports.
// A consumer authoring `animationName: kitMotion.pulse` through a plain named
// import must resolve to the FNV-hashed `animus-kf-<hash>` name with the
// matching `@keyframes` block emitted exactly once. The frame body is
// deliberately DISTINCT from the vite-app's inline `pulse` (opacity, not
// scale) so the kit block is its own unique body, not a dedupe alias.
export const kitMotion = createKeyframes({
  pulse: {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.6 },
  },
});
