import { useState, useEffect } from 'react';

import { ds } from '../../ds';

const ToggleButton = ds
  .styles({
    fontFamily: 'mono',
    fontSize: '11px',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'textMuted',
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'primary' },
  })
  .asElement('button');

export function ColorModeToggle() {
  const [mode, setMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return (
        document.documentElement.getAttribute('data-color-mode') || 'dark'
      );
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-color-mode', mode);
    localStorage.setItem('animus-color-mode', mode);
  }, [mode]);

  return (
    <ToggleButton onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}>
      {mode}
    </ToggleButton>
  );
}
