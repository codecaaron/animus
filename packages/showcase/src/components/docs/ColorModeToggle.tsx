import { useEffect, useState } from 'react';

import { ds } from '../../ds';

const ToggleButton = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'text.muted',
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'primary' },
  })
  .asElement('button');

const MODES = [
  'dark',
  'light',
  'midnight',
  'ember',
  'ocean',
  'forest',
  'violet',
  'rose',
  'terra',
  'adobe',
] as const;

export function ColorModeToggle() {
  const [mode, setMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-color-mode') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-color-mode', mode);
    localStorage.setItem('animus-color-mode', mode);
  }, [mode]);

  return (
    <ToggleButton
      onClick={() =>
        setMode((m) => {
          const i = MODES.indexOf(m as (typeof MODES)[number]);
          return MODES[(i + 1) % MODES.length];
        })
      }
    >
      {mode}
    </ToggleButton>
  );
}
