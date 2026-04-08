import { useCallback, useEffect, useRef, useState } from 'react';

import { ds } from '../../ds';

// ─── Mode Preview Data ────────────────────────────────────────────
// Hardcoded hex values from ds.ts color mode definitions.
// bg = background._, primary = primary._, text = text._

const MODES = [
  { name: 'dark', bg: '#000000', primary: '#FF2800', text: '#E8E0D0' },
  { name: 'light', bg: '#F2EBE0', primary: '#C1121F', text: '#111111' },
  { name: 'midnight', bg: '#000000', primary: '#FF2800', text: '#e0e0e0' },
  { name: 'ocean', bg: '#f0f7ff', primary: '#003d99', text: '#111111' },
  { name: 'ember', bg: '#2e0508', primary: '#FF6B35', text: '#ffe0d4' },
  { name: 'forest', bg: '#f0faf4', primary: '#145c36', text: '#111111' },
  { name: 'violet', bg: '#10001a', primary: '#9d3dff', text: '#f0f0f0' },
  { name: 'rose', bg: '#fff1f2', primary: '#be123c', text: '#111111' },
  { name: 'terra', bg: '#140c06', primary: '#b8834a', text: '#E8E0D0' },
  { name: 'adobe', bg: '#fdf6f0', primary: '#5c3a1e', text: '#111111' },
] as const;

// ─── Swatch Component ─────────────────────────────────────────────

const SwatchOuter = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    p: 0,
    outline: 'none',
    transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    _hover: {
      transform: 'scale(1.06)',
    },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '4px',
    },
  })
  .asElement('button');

const SwatchLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    lineHeight: 'none',
  })
  .asElement('span');

const PaletteGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 4,
    p: 16,
  })
  .asElement('div');

const PaletteHeading = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    px: 16,
    py: 8,
  })
  .asElement('div');

// ─── ColorPalette Component ───────────────────────────────────────

export function ColorPalette() {
  const [currentMode, setCurrentMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-color-mode') || 'dark';
    }
    return 'dark';
  });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const selectMode = useCallback((mode: string) => {
    setCurrentMode(mode);
    document.documentElement.setAttribute('data-color-mode', mode);
    localStorage.setItem('animus-color-mode', mode);
  }, []);

  // Arrow key navigation for radiogroup
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = MODES.findIndex((m) => m.name === currentMode);
      let next = idx;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        next = (idx + 1) % MODES.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        next = (idx - 1 + MODES.length) % MODES.length;
      } else {
        return;
      }

      selectMode(MODES[next].name);
      // Focus the newly selected swatch
      const buttons = gridRef.current?.querySelectorAll<HTMLElement>(
        'button[role="radio"]'
      );
      buttons?.[next]?.focus();
    },
    [currentMode, selectMode]
  );

  // Sync with external changes (e.g., if the cycle toggle is still used elsewhere)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const mode =
        document.documentElement.getAttribute('data-color-mode') || 'dark';
      setCurrentMode(mode);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <PaletteHeading>Color mode</PaletteHeading>
      <PaletteGrid
        ref={gridRef}
        role="radiogroup"
        aria-label="Color mode"
        onKeyDown={handleKeyDown}
      >
        {MODES.map((mode) => {
          const isActive = currentMode === mode.name;
          return (
            <SwatchOuter
              key={mode.name}
              role="radio"
              aria-checked={isActive}
              aria-label={mode.name}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectMode(mode.name)}
            >
              <div
                style={{
                  width: 48,
                  height: 56,
                  display: 'flex',
                  flexDirection: 'column',
                  border: isActive
                    ? `2px solid ${mode.primary}`
                    : '1px solid var(--color-border)',
                  overflow: 'hidden',
                }}
              >
                {/* bg band (60%) */}
                <div
                  style={{
                    flex: '3',
                    backgroundColor: mode.bg,
                  }}
                />
                {/* primary line */}
                <div
                  style={{
                    height: 2,
                    backgroundColor: mode.primary,
                    flexShrink: 0,
                  }}
                />
                {/* text band (40%) */}
                <div
                  style={{
                    flex: '2',
                    backgroundColor: mode.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 2,
                      backgroundColor: mode.text,
                      opacity: 0.6,
                    }}
                  />
                </div>
              </div>
              <SwatchLabel>{mode.name}</SwatchLabel>
            </SwatchOuter>
          );
        })}
      </PaletteGrid>
    </>
  );
}
