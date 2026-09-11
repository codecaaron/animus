import { useCallback, useEffect, useRef, useState } from 'react';

import { SYSTEM_MODE, persistColorMode } from '@animus-ui/system/appearance';

import { ds, theme } from '../../ds';

// Preview hexes duplicate the ds.ts modes: bg = background._, primary =
// primary._, text = text._. A mode edit in ds.ts must land here too.

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

type ModePreview = (typeof MODES)[number];

export const MODE_NAMES: readonly string[] = MODES.map((m) => m.name);

const SYSTEM_PREFERENCE = requireSystemPreference();

function requireSystemPreference() {
  const mapping = theme.manifest.systemPreference;
  if (!mapping) {
    throw new Error(
      'ColorPalette: the showcase theme must declare systemPreference — the System swatch previews its mapping.'
    );
  }
  return mapping;
}

function previewModeOf(name: string): ModePreview {
  const mode = MODES.find((m) => m.name === name);
  if (!mode) {
    throw new Error(
      `ColorPalette: systemPreference names mode '${name}' but MODES carries no preview entry for it.`
    );
  }
  return mode;
}

const OS_PREVIEW = [
  previewModeOf(SYSTEM_PREFERENCE.light),
  previewModeOf(SYSTEM_PREFERENCE.dark),
];

type PaletteOption = { kind: 'system' } | { kind: 'mode'; mode: ModePreview };

/** One option is checked in every state — System when no mode attribute is
 *  present — so the roving tab stop can just follow the checked radio. */
const OPTIONS: readonly PaletteOption[] = [
  { kind: 'system' },
  ...MODES.map((mode) => ({ kind: 'mode' as const, mode })),
];

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

// The border is extracted, not inline: an inline `border` would outrank the
// media-gated `osResolved` rule that alone lights the OS-resolved swatch.
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
      selected: { border: 2, borderColor: 'primary' },
    },
  })
  .asElement('div');

function osResolvedFor(
  hasActiveMode: boolean,
  name: string
): 'none' | 'dark' | 'light' {
  if (hasActiveMode) return 'none';
  if (name === SYSTEM_PREFERENCE.dark) return 'dark';
  if (name === SYSTEM_PREFERENCE.light) return 'light';
  return 'none';
}

function SwatchBands({
  preview,
  showText = false,
}: {
  preview: ModePreview;
  showText?: boolean;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 3, backgroundColor: preview.bg }} />
      <div
        style={{ height: 2, backgroundColor: preview.primary, flexShrink: 0 }}
      />
      <div
        style={{
          flex: 2,
          backgroundColor: preview.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showText ? (
          <div
            style={{
              width: 16,
              height: 2,
              backgroundColor: preview.text,
              opacity: 0.6,
            }}
          />
        ) : null}
      </div>
    </div>
  );
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

export function ColorPalette() {
  // `null` is not a mode: the attribute is absent and the OS drives the
  // palette, so the System option is the checked one.
  const [currentMode, setCurrentMode] = useState<string | null>(() =>
    document.documentElement.getAttribute('data-color-mode')
  );
  const gridRef = useRef<HTMLDivElement | null>(null);

  const hasActiveMode = MODES.some((m) => m.name === currentMode);

  const selectMode = useCallback((mode: string) => {
    setCurrentMode(mode);
    document.documentElement.setAttribute('data-color-mode', mode);
    persistColorMode(mode);
  }, []);

  // Persisting `system` alongside the attribute's REMOVAL is what makes the
  // bootstrap restore absence on the next load.
  const selectSystem = useCallback(() => {
    setCurrentMode(null);
    document.documentElement.removeAttribute('data-color-mode');
    persistColorMode(SYSTEM_MODE);
  }, []);

  const selectOption = useCallback(
    (option: PaletteOption) => {
      if (option.kind === 'system') selectSystem();
      else selectMode(option.mode.name);
    },
    [selectMode, selectSystem]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (!forward && !backward) return;
      e.preventDefault();

      const buttons = Array.from(
        gridRef.current?.querySelectorAll<HTMLElement>(
          'button[role="radio"]'
        ) ?? []
      );

      // Origin is the FOCUSED swatch, not the selected one: originating from
      // the selection while focus sits elsewhere eats the keystroke.
      const focusedIdx = buttons.findIndex(
        (button) => button === document.activeElement
      );
      const origin =
        focusedIdx !== -1
          ? focusedIdx
          : Math.max(
              OPTIONS.findIndex((option) =>
                option.kind === 'system'
                  ? !hasActiveMode
                  : option.mode.name === currentMode
              ),
              0
            );
      const step = forward ? 1 : OPTIONS.length - 1;
      const next = (origin + step) % OPTIONS.length;

      selectOption(OPTIONS[next]);
      buttons[next]?.focus();
    },
    [currentMode, hasActiveMode, selectOption]
  );

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

  return (
    <>
      <PaletteHeading>Color mode</PaletteHeading>
      <PaletteGrid
        ref={gridRef}
        role="radiogroup"
        aria-label="Color mode"
        onKeyDown={handleKeyDown}
      >
        {OPTIONS.map((option) => {
          const label = option.kind === 'system' ? 'system' : option.mode.name;
          const isChecked =
            option.kind === 'system'
              ? !hasActiveMode
              : currentMode === option.mode.name;
          return (
            <SwatchOuter
              key={label}
              role="radio"
              aria-checked={isChecked}
              aria-label={label}
              tabIndex={isChecked ? 0 : -1}
              onClick={() => selectOption(option)}
            >
              {option.kind === 'system' ? (
                <SwatchCard osResolved={isChecked ? 'selected' : 'none'}>
                  <div style={{ flex: 1, display: 'flex' }}>
                    {OS_PREVIEW.map((half) => (
                      <SwatchBands key={half.name} preview={half} />
                    ))}
                  </div>
                </SwatchCard>
              ) : (
                <SwatchCard
                  osResolved={osResolvedFor(hasActiveMode, option.mode.name)}
                  // Inline only for the explicit active border, which needs
                  // this mode's own hex; the media-gated rule owns the rest.
                  style={
                    isChecked
                      ? { border: `2px solid ${option.mode.primary}` }
                      : undefined
                  }
                >
                  <SwatchBands preview={option.mode} showText />
                </SwatchCard>
              )}
              <SwatchLabel>{label}</SwatchLabel>
            </SwatchOuter>
          );
        })}
      </PaletteGrid>
    </>
  );
}
