// A prefixed consumer: one registered and one unregistered contextual
// variable, written under their declared names.
import { createSystem, createTheme } from '@animus-ui/system';
import { color, layout, transitions } from '@animus-ui/system/groups';

export const theme = createTheme()
  .addBreakpoints({ sm: 768 })
  .addColors({ ink: '#111', paper: '#fff' })
  .addScale({ name: 'sizes', values: { dialog: '40rem' } })
  .declareContextualVars(
    { colors: ['tone'], sizes: ['cap'] },
    { tone: { syntax: '<color>', inherits: true, initialValue: 'transparent' } }
  )
  .build();

export type PrefixedTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends PrefixedTheme {}
}

export const ds = createSystem()
  .addGroup('surface', color)
  .addGroup('box', layout)
  .addGroup('motion', transitions)
  .build()
  .seal();
