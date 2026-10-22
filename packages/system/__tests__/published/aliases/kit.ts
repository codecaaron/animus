import { createSystem, createTheme } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';

import type { ConditionsOf, SelectorsOf } from '@animus-ui/system';

// A system that registers a selector alias and no condition alias, published
// through the documented augmentation. Its own program: augmentation is global
// to a compilation, and this is the shape (one registry empty) where an
// unknown `_` key used to pass.
export const theme = createTheme()
  .addScale({ name: 'space', values: { sm: '0.5rem', md: '1rem' } })
  .addColors({ ink: '#111', paper: '#fff' })
  .build();

const bundle = createSystem()
  .addGroup('space', space)
  .addGroup('colors', color)
  .addSelectors({ _busy: '&[aria-busy="true"]' })
  .build();

export const ds = bundle.seal();

type KitTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends KitTheme {}
  interface Conditions extends Record<
    ConditionsOf<typeof bundle.system>,
    true
  > {}
  interface Selectors extends Record<SelectorsOf<typeof bundle.system>, true> {}
}

/** The empty registry publishes no alias name, and the full one its own. */
export type Published = [
  ConditionsOf<typeof bundle.system>,
  SelectorsOf<typeof bundle.system>,
];
