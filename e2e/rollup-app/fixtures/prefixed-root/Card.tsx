import { ds } from './ds';

export const Card = ds
  .styles({
    bg: 'tone',
    '--tone': 'red',
    '--edge': 'var(--cap, var(--tone))',
    '--ring': '{colors.tone}',
    transition: '--tone 1s',
    '@container style(--tone: red)': { '--cap': '2px' },
    _toned: { '--cap': '3px' },
  })
  .props({
    capSize: { property: '--cap', scale: 'sizes', strict: false },
    tint: { property: 'color', scale: 'colors', currentVar: '--tone' },
    look: { kind: 'declarations', scale: 'looks', members: ['color'] },
  })
  .asElement('div');
