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
  .build();
