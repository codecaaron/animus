export * from './types/props';
export * from './types/theme';
export * from './types/utils';

export * from './scales/createScale';
export * from './configBuilder';
export * from './createAnimus';
export * from './transforms';

import { createAnimus } from './createAnimus';
import * as props from './props/baseConfig';

export const coreConfig = createAnimus()
  .addGroup('space', props.space)
  .addGroup('background', props.background)
  .addGroup('layout', props.layout)
  .addGroup('color', props.color)
  .addGroup('typography', props.typography)
  .addGroup('shadows', props.shadows)
  .addGroup('borders', props.border)
  .addGroup('positioning', props.positioning)
  .addGroup('flex', props.flex)
  .addGroup('grid', props.grid)
  .addGroup('mode', props.mode);

export const animus = coreConfig.build();
