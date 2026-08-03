import { useCallback, useEffect, useRef, useState } from 'react';

import { SYSTEM_MODE, persistColorMode } from '@animus-ui/system/appearance';

import { ds, tokens } from '../../ds';

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

type ModePreview = (typeof MODES)[number];

/** Declared mode names, in palette order. Consumed by the legacy migration. */
export const MODE_NAMES: readonly string[] = MODES.map((m) => m.name);

/**
 * The OS mapping, read from the BUILT theme rather than restated: ds.ts owns
 * `systemPreference`, and both the System swatch's preview halves and the
 * media-gated `osResolved` treatment follow it — a remap in ds.ts moves both.
 */
const SYSTEM_PREFERENCE = requireSystemPreference();

function requireSystemPreference() {
  const mapping = tokens.manifest.systemPreference;
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

/** What "follow the OS" resolves to: the mapped light half, then the dark. */
const OS_PREVIEW = [
  previewModeOf(SYSTEM_PREFERENCE.light),
  previewModeOf(SYSTEM_PREFERENCE.dark),
];

type PaletteOption =
  | { kind: 'system' }
  | { kind: 'mode'; mode: ModePreview };

/**
 * Radio order, single source: System first, then the declared modes. One
 * option is checked in EVERY state — System when the attribute is absent, the
 * matching mode swatch otherwise — which is what lets the roving tab stop
 * simply follow the checked radio, and lets keyboard navigation index this
 * array with no offset arithmetic.
 */
const OPTIONS: readonly PaletteOption[] = [
  { kind: 'system' },
  ...MODES.map((mode) => ({ kind: 'mode' as const, mode })),
];

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
// `selected` — the System radio's checked ring — rides the same trick: with
// the attribute absent, `primary` resolves to the OS-resolved mode's own.
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

/**
 * Which swatch carries the media-gated treatment: only in the state where no
 * explicit mode is active, and only the two modes `systemPreference` maps.
 */
function osResolvedFor(
  hasActiveMode: boolean,
  name: string
): 'none' | 'dark' | 'light' {
  if (hasActiveMode) return 'none';
  if (name === SYSTEM_PREFERENCE.dark) return 'dark';
  if (name === SYSTEM_PREFERENCE.light) return 'light';
  return 'none';
}

/**
 * The swatch preview interior — bg band (60%) / primary rule / bg band (40%),
 * optionally carrying the text mark. One implementation for both the mode
 * swatches and the System swatch's split halves, so the proportions and the
 * 2px rule cannot drift between the two.
 */
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

// ─── ColorPalette Component ───────────────────────────────────────

export function ColorPalette() {
  // `null` = no explicit mode: the attribute is absent and the OS preference is
  // driving the palette, so the System option is the active one.
  const [currentMode, setCurrentMode] = useState<string | null>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-color-mode');
    }
    return null;
  });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const hasActiveMode = MODES.some((m) => m.name === currentMode);

  const selectMode = useCallback((mode: string) => {
    setCurrentMode(mode);
    document.documentElement.setAttribute('data-color-mode', mode);
    persistColorMode(mode);
  }, []);

  // Returning to the OS-driven state is the attribute's REMOVAL plus a
  // persisted `system` — the record round-trips it, and the generated
  // bootstrap restores absence on the next load. Without this option an
  // explicit pick would be a one-way door.
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

  // Arrow key navigation for radiogroup
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

      // Navigation origins at the FOCUSED swatch — not the selected one:
      // deriving `from` from the selection while focus sits elsewhere would
      // compute a move back onto the focused cell, eating the keystroke.
      // Selection is the fallback, and one option is checked in every state
      // (System when no mode is explicit), so the fallback always exists.
      const focusedIdx = buttons.indexOf(document.activeElement as HTMLElement);
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
      // Focus the newly selected swatch
      buttons[next]?.focus();
    },
    [currentMode, hasActiveMode, selectOption]
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
              // Roving tabindex: exactly one radio is checked in every state,
              // and the checked radio is the tab stop — the radiogroup never
              // falls out of the tab order.
              tabIndex={isChecked ? 0 : -1}
              onClick={() => selectOption(option)}
            >
              {option.kind === 'system' ? (
                <SwatchCard osResolved={isChecked ? 'selected' : 'none'}>
                  {/* split preview: the two OS-mapped modes, side by side */}
                  <div style={{ flex: 1, display: 'flex' }}>
                    {OS_PREVIEW.map((half) => (
                      <SwatchBands key={half.name} preview={half} />
                    ))}
                  </div>
                </SwatchCard>
              ) : (
                <SwatchCard
                  osResolved={osResolvedFor(hasActiveMode, option.mode.name)}
                  // Only the EXPLICIT active border is inline: it needs this
                  // mode's own primary hex. In the OS-driven state no swatch is
                  // explicitly active, so no inline border exists to outrank
                  // the media-gated `osResolved` rule.
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
