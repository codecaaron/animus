import { ds } from '../system';

export const GroupItem = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 8,
    py: 4,
    borderRadius: '4px',
    bg: 'surface',
    color: 'text',
    '[data-active="true"] &': {
      bg: 'primary',
      color: 'background',
    },
    _groupHover: { opacity: '0.9' },
    _dark: { color: 'text.muted' },
  })
  .asElement('span');
