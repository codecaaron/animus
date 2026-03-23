/**
 * Custom Vocabulary Demo
 *
 * Same props as the default config, but organized into groups
 * that match how a DESIGN TEAM thinks — not how CSS specs are written.
 *
 * One config per app. One instance. All extraction works because
 * the prop→CSS mappings are the same.
 */
import {
  background,
  border,
  color,
  createAnimus,
  flex,
  grid,
  layout,
  positioning,
  serializeExtractConfig,
  shadows,
  space,
  transitions,
  typography,
} from '@animus-ui/core';

// ─── Regrouped: Designer-Friendly Categories ─────────────────

// "surface" = how a box LOOKS (color + border + shadow + radius)
const surface = {
  ...color,
  ...border,
  ...shadows,
  ...background,
} as const;

// "arrange" = how children are LAID OUT (flex + grid + alignment + gaps)
const arrange = {
  ...flex,
  ...grid,
  ...layout,
} as const;

// "text" = everything about TYPE
const text = {
  ...typography,
} as const;

// "motion" = transitions and animation
const motion = {
  ...transitions,
} as const;

// ─── Build the Custom Instance ──────────────────────────────

export const ds = createAnimus()
  .addGroup('surface', surface)
  .addGroup('arrange', arrange)
  .addGroup('text', text)
  .addGroup('motion', motion)
  .addGroup('space', space)
  .addGroup('positioning', positioning)
  .build();

// ─── Extraction Config ──────────────────────────────────────

/** Serialize this instance's config for the Vite extraction plugin. */
export const getExtractConfig = () => serializeExtractConfig(ds);

// ─── Components using the regrouped vocabulary ──────────────

// A panel: surface + space is all you need
export const Panel = ds
  .styles({
    bg: 'surface',
    borderRadius: 12,
    border: 1,
    borderColor: 'border',
    p: 24,
    transition: 'all 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('div');

// Arrange: one group for all layout
export const Arrange = ds
  .styles({
    display: 'flex',
  })
  .groups({ arrange: true, space: true })
  .asElement('div');

// Grid variant of Arrange
export const GridArrange = ds
  .styles({
    display: 'grid',
  })
  .groups({ arrange: true, space: true })
  .asElement('div');

// Prose: text + surface (for color) + space
export const Prose = ds
  .styles({
    fontFamily: 'base',
    fontSize: 16,
    lineHeight: 'base',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('p');

// Chip: interactive label
export const Chip = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'mono',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.04em',
    borderRadius: 'full',
    lineHeight: 'snug',
    px: 12,
    py: 4,
    bg: 'backgroundMuted',
    color: 'textMuted',
    transition: 'background-color 0.1s ease',
    '&:hover': {
      bg: 'surface',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('span');
