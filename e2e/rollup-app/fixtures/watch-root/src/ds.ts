// `badGlow` returns an object on purpose: an invalid transform result shape
// the engine escalates to an error diagnostic when a component uses it.
import { createSystem, createTheme, createTransform } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5', 700: '#404040' } })
  .build();

const badGlow = createTransform('badGlow', (value) => ({
  boxShadow: String(value),
}));

export const ds = createSystem()
  .addGroup('fx', {
    glow: {
      property: 'boxShadow',
      transform: badGlow,
    },
  })
  .build(theme)
  .seal();
