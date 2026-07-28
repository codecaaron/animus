import { useCallback, useEffect, useRef, useState } from 'react';

import { ds } from '../../ds';
import { persistColorMode } from '../../lib/appearance';

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

/** Declared mode names, in palette order. Consumed by the legacy migration. */
export const MODE_NAMES: readonly string[] = MODES.map((m) => m.name);

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

// The swatch card. Its border is EXTRACTED, not inline, for two reasons: the
// OS-resolved treatment below is a media-gated rule that an inline `border`
// would outrank, and the inactive border is a plain token lookup.
//
// `osResolved` implements the `color-mode-palette` requirement "when no
// explicit mode is active … the swatch of the OS-resolved mode SHALL carry the
// active treatment, applied through OS-preference media conditions rather than
// script". React contributes only the fact that NO mode is explicit — state it
// already tracks for `aria-checked`. WHICH swatch lights up is decided by the
// `@media (prefers-color-scheme: …)` blocks alone, so an OS flip moves the
// treatment with no listener, no matchMedia, and no re-render.
//
// `borderColor: 'primary'` is self-referential for free: with no attribute
// present, the SAME media query that selects this rule has already rebound
// `--color-primary` to the mapped mode's own primary (ds.ts emits
// `@media (prefers-color-scheme: …) { :root:not([data-color-mode]) { … } }`).
// So the dark swatch borders in dark's primary and the light swatch in
// light's, with no hex duplicated here and no drift if the mapping changes.
const SwatchCard = ds
  .styles({
    width: '48px',
    height: '56px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: 1,
    borderColor: 'border',
  })
  .variant({
    prop: 'osResolved',
    defaultVariant: 'none',
    variants: {
      none: {},
      dark: { _osDark: { border: 2, borderColor: 'primary' } },
      light: { _osLight: { border: 2, borderColor: 'primary' } },
    },
  })
  .asElement('div');

/**
 * `systemPreference` in ds.ts: OS light → the `light` mode, OS dark → `dark`.
 * Those two swatches — and only in the state where no explicit mode is active —
 * carry the media-gated treatment; everything else opts out.
 */
function osResolvedFor(
  hasActiveMode: boolean,
  name: string
): 'none' | 'dark' | 'light' {
  if (hasActiveMode) return 'none';
  if (name === 'dark') return 'dark';
  if (name === 'light') return 'light';
  return 'none';
}

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
  // `null` = no explicit mode: the attribute is absent and the OS preference is
  // driving the palette, so no swatch is the active one.
  const [currentMode, setCurrentMode] = useState<string | null>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-color-mode');
    }
    return null;
  });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const selectMode = useCallback((mode: string) => {
    setCurrentMode(mode);
    document.documentElement.setAttribute('data-color-mode', mode);
    persistColorMode(mode);
  }, []);

  // Arrow key navigation for radiogroup
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const buttons = Array.from(
        gridRef.current?.querySelectorAll<HTMLElement>(
          'button[role="radio"]'
        ) ?? []
      );

      // Navigation origins at the FOCUSED swatch — not the selected one. In the
      // OS-driven state nothing is selected while focus still sits on a real
      // swatch (the roving tab stop), and deriving `from` from the selection
      // there would compute a move back onto the focused cell, eating the
      // keystroke: "focus SHALL move to the next swatch" would be false on the
      // very first press. Selection is the fallback, then the first cell.
      const focusedIdx = buttons.indexOf(document.activeElement as HTMLElement);
      const selectedIdx = MODES.findIndex((m) => m.name === currentMode);
      const from = focusedIdx !== -1 ? focusedIdx : selectedIdx;
      const origin = from === -1 ? 0 : from;
      let next: number;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        next = (origin + 1) % MODES.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        next = (origin - 1 + MODES.length) % MODES.length;
      } else {
        return;
      }

      selectMode(MODES[next].name);
      // Focus the newly selected swatch
      buttons[next]?.focus();
    },
    [currentMode, selectMode]
  );

  // Sync with external changes (e.g., if the cycle toggle is still used elsewhere)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCurrentMode(document.documentElement.getAttribute('data-color-mode'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode'],
    });
    return () => observer.disconnect();
  }, []);

  const hasActiveMode = MODES.some((m) => m.name === currentMode);

  return (
    <>
      <PaletteHeading>Color mode</PaletteHeading>
      <PaletteGrid
        ref={gridRef}
        role="radiogroup"
        aria-label="Color mode"
        onKeyDown={handleKeyDown}
      >
        {MODES.map((mode, index) => {
          const isActive = currentMode === mode.name;
          // Roving tabindex. With no explicit mode stored the OS drives the
          // palette and nothing is checked — the first swatch stays tabbable so
          // the radiogroup never falls out of the tab order.
          const isTabStop = hasActiveMode ? isActive : index === 0;
          return (
            <SwatchOuter
              key={mode.name}
              role="radio"
              aria-checked={isActive}
              aria-label={mode.name}
              tabIndex={isTabStop ? 0 : -1}
              onClick={() => selectMode(mode.name)}
            >
              <SwatchCard
                osResolved={osResolvedFor(hasActiveMode, mode.name)}
                // Only the EXPLICIT active border is inline: it needs this
                // mode's own primary hex. In the OS-driven state no swatch is
                // explicitly active, so no inline border exists to outrank the
                // media-gated `osResolved` rule.
                style={
                  isActive
                    ? { border: `2px solid ${mode.primary}` }
                    : undefined
                }
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
              </SwatchCard>
              <SwatchLabel>{mode.name}</SwatchLabel>
            </SwatchOuter>
          );
        })}
      </PaletteGrid>
    </>
  );
}
