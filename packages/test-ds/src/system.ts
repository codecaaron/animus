/**
 * System config for library development only.
 * NOT exported from index.ts — consumers use their own system config.
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
