// `createTransform` captures source so the sandbox evaluates it; a bare arrow
// would degrade to the warn-and-fallback path instead of an error diagnostic.
import { createSystem, createTheme, createTransform } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5' } })
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
