import { createSystem, createTheme } from '../src';
import { color, layout, space, typography } from '../src/groups';

import type { ConditionsOf, SelectorsOf } from '../src';

export const tokens = createTheme()
  .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
  .addScale({
    name: 'space',
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
  })
  .addScale({
    name: 'fontSizes',
    values: { 14: '0.875rem', 16: '1rem' },
  })
  .addColors({ red: '#f00', blue: '#00f' })
  .addColorModes('dark', {
    dark: { primary: 'red', bg: 'blue' },
    light: { primary: 'blue', bg: 'red' },
  })
  .declareContextualVars({
    colors: ['current-bg'],
  })
  .build();

type TestTheme = typeof tokens;

declare module '../src' {
  interface Theme extends TestTheme {}
}

const bundle = createSystem()
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('surface', color)
  .addGroup('arrange', layout)
  .addProps({
    ratio: { property: 'aspectRatio' } as const,
  })
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
    _cardSm: '@container card (min-width: 400px)',
    _supportsGrid: '@supports (display: grid)',
  })
  .addSelectors({
    _hoverChild: '&:hover > *',
  })
  .build();

export const { createGlobalStyles, createKeyframes } = bundle;

export const ds = bundle.seal();

declare module '../src' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Conditions extends Record<ConditionsOf<typeof ds>, true> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Selectors extends Record<SelectorsOf<typeof ds>, true> {}
}
