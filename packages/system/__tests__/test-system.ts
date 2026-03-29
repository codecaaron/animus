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

export const tokens = createTheme({
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
})
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
  .addContextualVars({
    colors: ['current-bg'],
  })
  .build();

type TestTheme = typeof tokens;

declare module '../src' {
  interface Theme extends TestTheme {}
}

export const ds = createSystem()
  .withProperties((p) =>
    p
      .addGroup('space', space)
      .addGroup('text', typography)
      .addGroup('surface', color)
      .addGroup('arrange', layout)
      .build()
  )
  .build();
