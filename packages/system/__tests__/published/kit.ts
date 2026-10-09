import { createSystem, createTheme } from '@animus-ui/system';
import {
  background,
  border,
  color,
  flex,
  grid,
  layout,
  positioning,
  shadows,
  space,
  typography,
} from '@animus-ui/system/groups';

import type { ConditionsOf, SelectorsOf } from '@animus-ui/system';

export const theme = createTheme()
  .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
  .addScale({
    name: 'space',
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
  })
  .addColors({ ink: '#111', paper: '#fff' })
  .addDeclarationScale({
    name: 'looks',
    values: {
      loud: { backgroundColor: 'red' },
      calm: { backgroundColor: 'green' },
    },
  })
  .build();

const bundle = createSystem()
  .addGroup('space', space)
  .addGroup('colors', color)
  .addGroup('backgrounds', background)
  .addGroup('borders', border)
  .addGroup('shadow', shadows)
  .addGroup('layout', layout)
  .addGroup('flexbox', flex)
  .addGroup('grid', grid)
  .addGroup('positioning', positioning)
  .addGroup('typography', typography)
  .addProps({
    gutter: { property: 'gap', scale: { tight: '2px', roomy: '8px' } },
    inset: { property: 'padding', scale: 'space', strict: false },
    look: {
      kind: 'declarations',
      scale: 'looks',
      members: ['backgroundColor'],
    },
  } as const)
  .addConditions({ _motionReduce: '@media (prefers-reduced-motion: reduce)' })
  .addSelectors({ _childHover: '&:hover > *' })
  .build();

export const pulse = bundle.createKeyframes({
  fade: { from: { opacity: 0 }, to: { opacity: 1 } },
});

export const ds = bundle.registerKeyframes({ pulse }).seal();

type KitTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends KitTheme {}
  interface Conditions extends Record<
    ConditionsOf<typeof bundle.system>,
    true
  > {}
  interface Selectors extends Record<SelectorsOf<typeof bundle.system>, true> {}
}
