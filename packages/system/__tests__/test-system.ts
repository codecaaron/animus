/**
 * Shared test fixture: theme + system for all @animus-ui/system tests.
 *
 * This is the single source of truth for:
 * - Theme shape (tokens, scales, colors, color modes)
 * - System shape (prop groups)
 * - Theme interface augmentation (declare module)
 *
 * Both runtime tests (bun test) and type tests (tsc --noEmit) import this.
 */
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

export const {
  system: ds,
  createGlobalStyles,
  createKeyframes,
} = createSystem()
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('surface', color)
  .addGroup('arrange', layout)
  .addProps({
    ratio: { property: 'aspectRatio' } as const,
  })
  // Condition alias registry (modern-css-surface inc 04): one of each kind so
  // the §14 fixtures exercise media / container / supports block keys against a
  // POPULATED publication (below). Registered keys accumulate into the phantom
  // `Conds` union surfaced on the built system.
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
    _cardSm: '@container card (min-width: 400px)',
    _supportsGrid: '@supports (display: grid)',
  })
  // Custom SELECTOR alias — folds into the same publication (design D9), making
  // it a typed block key AND a typed component callsite prop (§14g).
  .addSelectors({
    _hoverChild: '&:hover > *',
  })
  .build();

// Publish the registered condition + selector aliases through module
// augmentation (design D9 — the same mechanism as the augmented `Theme`
// below). This flips the `ThemedCSSProps` arms from permissive to VALIDATING:
// unknown `_` keys now resolve to branded `UnknownConditionAlias`. A system
// that skips this augmentation (e.g. the vite-app fixture) stays permissive.
declare module '../src' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Conditions extends Record<ConditionsOf<typeof ds>, true> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Selectors extends Record<SelectorsOf<typeof ds>, true> {}
}
