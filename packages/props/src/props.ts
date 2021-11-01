import * as props from './config';
import { createAnimus } from '@animus/core';

import { theme } from '@animus/theme';

type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}

export const animus = createAnimus()
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
  .addGroup('mode', {
    mode: {
      property: 'none',
      scale: 'mode',
    },
    vars: {
      property: 'variables',
    },
  })
  .build();
