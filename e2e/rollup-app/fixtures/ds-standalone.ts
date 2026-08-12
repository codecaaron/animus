// Standalone minimal system for the zero-file negative: resolvable from the
// empty root (one level up), no includes, no local sources.
import { createSystem, createTheme } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5' } })
  .build();

export const { system: ds } = createSystem()
  .addGroup('color', {
    color: { property: 'color', scale: 'colors' },
  })
  .build(theme);
