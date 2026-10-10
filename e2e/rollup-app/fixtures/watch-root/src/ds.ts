import { createSystem, createTheme } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5', 700: '#404040' } })
  .build();

export const ds = createSystem().build(theme).seal();
