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

const kitBundle = createSystem()
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .addGroup('positioning', positioning)
  // Condition alias registry (media-condition-aliases). Exercises the
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
  // Selector alias registry with ANCESTOR-subject values
  // (selector-alias-registry): both aliases place `&` after an ancestor prefix,
  // so they must emit with the composed class substituted at the subject
  // position. GroupItem consumes both; consumers that `.extend()` this kit
  // inherit the aliases through the registry merge, which is what lets the
  // kit's own GroupItem CSS emit under a consumer's merged system.
  .addSelectors({
    _groupHover: '.group:hover &',
    _dark: '[data-color-mode="dark"] &',
  })
  .build();

export const { createKeyframes } = kitBundle;

// Kit keyframe collection (vocabulary-registration › sealed-kit carriage):
// DEFINED inside the loader-evaluated definition graph (this module sits on
// the `definition.ts` path) and re-exported from the package root so a
// consumer's plain named import keeps resolving — the engine follows the
// re-export chain to THIS module's export name, which equals the
// registration key below. The frame body is deliberately DISTINCT from the
// vite-app's inline `pulse` (opacity, not scale) so the kit block is its
// own unique body, not a dedupe alias.
export const kitMotion = createKeyframes({
  pulse: {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.6 },
  },
});

// The sealed kit instance: registration closes here, and `.extend()`
// consumers inherit `kitMotion` through the vocabulary record.
export const ds = kitBundle.registerKeyframes({ kitMotion }).seal();
