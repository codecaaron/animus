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

// Identifier-backed variant map (semantic-const-resolution): consumers
// reference this via a plain named import (`variants: kitSizes`) and the
// extraction-time statics resolver must
// produce the same manifest options and CSS as inlining the literal — the
// `as const` wrapper must be transparent to static evaluation. Values stay
// inside the kit token vocabulary (fontSizes 14/16/20, space 4/8/12/16/24).
export const kitSizes = {
  sm: { fontSize: 14, px: 8, py: 4 },
  md: { fontSize: 16, px: 16, py: 8 },
  lg: { fontSize: 20, px: 24, py: 12 },
} as const;

// Kit keyframe collection (vocabulary-registration › sealed-kit carriage):
// DEFINED in `./system` inside the definition graph and registered on the
// sealed kit; the root re-export preserves the historical consumer import
// path (`import { kitMotion } from '@animus-ui/test-ds'`). The engine
// resolves the re-export chain to the defining module's export name, which
// equals the registration key — a consumer authoring
// `animationName: kitMotion.pulse` through this plain named import resolves
// to the FNV-hashed `animus-kf-<hash>` name with the matching `@keyframes`
// block emitted exactly once.
export { kitMotion } from './system';
