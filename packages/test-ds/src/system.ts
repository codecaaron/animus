/**
 * Reference system config used by the test-ds components below AND
 * re-exported as `ds` from index.ts so showcase / next-app fixtures can
 * import a fully-configured system without re-implementing one. Real
 * consumers ship their own system config; test-ds is library-development
 * scaffolding.
 */
import { createSystem } from '@animus-ui/system';
import {
  border,
  color,
  flex,
  layout,
  positioning,
  space,
  typography,
} from '@animus-ui/system/groups';

export const { system: ds } = createSystem()
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .addGroup('positioning', positioning)
  // Condition alias registry (modern-css-surface inc 03). Exercises the
  // `addConditions()` builder + the `conditionAliases` manifest field across
  // all three kinds. Aliased blocks only emit when the EXTRACTING system
  // carries these registrations, so the component fixtures below use RAW
  // at-rule keys (which need no registration); these aliases document the API
  // shape and keep the serialized manifest populated.
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
    _cardSm: '@container card (min-width: 400px)',
    _hasGrid: '@supports (display: grid)',
  })
  .build();
