/**
 * ANIMUS — The Forge
 *
 * All components use the custom `ds` instance.
 * Groups: surface, arrange, text, motion, space, positioning
 * Custom props: fluidSize (text), ratio (arrange), ring (surface)
 *
 * Aesthetic: Forge Brutalism. Vermilion on void. Zero border-radius. Dense.
 */
import { ds } from './ds';

// ─── Primitives ──────────────────────────────────────────────

export const Box = ds
  .styles({ display: 'block' })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');

export const Stack = ds
  .styles({ display: 'flex', flexDirection: 'column' })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const Row = ds
  .styles({ display: 'flex', flexDirection: 'row', alignItems: 'center' })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const Container = ds
  .styles({
    width: 1,
    maxWidth: '72rem',
    mx: 'auto',
    px: { _: 16, sm: 24, md: 48 },
  })
  .asElement('div');

export const Section = ds
  .styles({ py: { _: 48, md: 96 } })
  .groups({ surface: true, space: true })
  .asElement('section');

// ─── Typography ──────────────────────────────────────────────

export const Heading = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 800,
    lineHeight: 'none',
    letterSpacing: '-0.02em',
    textTransform: 'uppercase',
    color: 'text',
    m: 0,
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: { _: 56, md: 72 } },
      h2: { fontSize: { _: 40, md: 56 } },
      h3: { fontSize: { _: 24, md: 32 } },
      h4: { fontSize: 20 },
    },
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('h2');

export const Text = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'base',
    color: 'text',
    m: 0,
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 14 },
      base: { fontSize: 16 },
      lg: { fontSize: 18, lineHeight: 'loose' },
      xl: { fontSize: 20, lineHeight: 'loose' },
    },
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('p');

export const Code = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    bg: 'backgroundMuted',
    color: 'primary',
    px: 6,
    py: 2,
    borderRadius: 0,
    lineHeight: 'base',
  })
  .asElement('code');

export const Label = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'textMuted',
    m: 0,
  })
  .groups({ surface: true, space: true })
  .asElement('span');

// ─── Interactive ──────────────────────────────────────────────

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'body',
    fontWeight: 700,
    lineHeight: 'snug',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    borderRadius: 0,
    border: 'none',
    transition: 'filter 0.15s ease, box-shadow 0.15s ease',
    '&:hover': {
      filter: 'brightness(1.2)',
    },
  })
  .variant({
    defaultVariant: 'primary',
    variants: {
      primary: {
        bg: 'primary',
        color: 'background',
        px: 24,
        py: 12,
        fontSize: 14,
        '&:hover': {
          boxShadow: '0 0 12px rgba(255,40,0,0.3)',
        },
      },
      ghost: {
        bg: 'transparent',
        color: 'primary',
        border: 1,
        borderColor: 'primary',
        px: 24,
        py: 12,
        fontSize: 14,
        '&:hover': {
          bg: 'primary',
          color: 'background',
          filter: 'brightness(1)',
        },
      },
      kill: {
        bg: 'backgroundMuted',
        color: 'text',
        borderLeft: 4,
        borderColor: 'primary',
        px: 24,
        py: 12,
        fontSize: 14,
        '&:hover': {
          bg: 'primary',
          color: 'background',
        },
      },
      small: {
        bg: 'primary',
        color: 'background',
        px: 12,
        py: 6,
        fontSize: 11,
        letterSpacing: '0.08em',
      },
    },
  })
  .states({
    disabled: {
      opacity: 0.3,
      cursor: 'not-allowed',
    },
  })
  .groups({ space: true })
  .asElement('button');

// ─── Surfaces ──────────────────────────────────────────────

export const Card = ds
  .styles({
    bg: 'surface',
    borderRadius: 0,
    border: 1,
    borderColor: 'border',
    p: 24,
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      boxShadow: '0 0 1px rgba(255,40,0,0.4)',
    },
  })
  .states({
    interactive: {
      cursor: 'pointer',
      '&:hover': {
        borderColor: 'primary',
        boxShadow: '0 0 8px rgba(255,40,0,0.2)',
      },
    },
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');

export const Badge = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    borderRadius: 0,
    lineHeight: 'snug',
  })
  .variant({
    defaultVariant: 'default',
    variants: {
      default: { bg: 'backgroundMuted', color: 'textMuted', px: 8, py: 2 },
      primary: { bg: 'primary', color: 'background', px: 8, py: 2 },
      accent: { bg: 'accent', color: 'background', px: 8, py: 2 },
      success: { bg: 'success', color: 'background', px: 8, py: 2 },
      warning: { bg: 'warning', color: 'background', px: 8, py: 2 },
    },
  })
  .asElement('span');

export const Divider = ds
  .styles({
    border: 'none',
    height: '1px',
    m: 0,
    background: '#FF2800',
    boxShadow: '0 0 8px rgba(255,40,0,0.4), 0 0 24px rgba(255,40,0,0.1)',
  })
  .groups({ space: true })
  .asElement('hr');

// ─── Extension Chains ────────────────────────────────────────

export const SmallButton = Button.extend()
  .styles({
    px: 8,
    py: 4,
    fontSize: 11,
    borderRadius: 0,
    fontWeight: 500,
    letterSpacing: '0.08em',
  })
  .asElement('button');

export const FeatureCard = Card.extend()
  .styles({ p: 32, gap: 16 })
  .asElement('div');

export const ColorSwatch = ds
  .styles({
    width: '3rem',
    height: '3rem',
    borderRadius: 0,
    border: 1,
    borderColor: 'border',
  })
  .groups({ surface: true })
  .asElement('div');

// ─── App-Level Components ────────────────────────────────────

export const AppShell = ds
  .styles({
    minHeight: '100vh',
    fontFamily: 'body',
    bg: 'background',
    color: 'text',
  })
  .asElement('div');

export const Nav = ds
  .styles({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    py: 16,
  })
  .asElement('nav');

export const Logo = ds
  .styles({
    fontFamily: 'logo',
    fontSize: 20,
    m: 0,
    fontWeight: 400,
    letterSpacing: '0.2em',
    textTransform: 'lowercase',
    color: 'primary',
    animation: 'ember 4s ease-in-out infinite',
    cursor: 'default',
    '&:hover': {
      animationPlayState: 'paused',
    },
  })
  .asElement('span');

export const AnchorHeading = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 800,
    lineHeight: 'none',
    letterSpacing: '-0.02em',
    textTransform: 'uppercase',
    color: 'text',
    m: 0,
    textDecoration: 'none',
    transition: 'color 0.15s ease',
    cursor: 'pointer',
    '&:hover': {
      textDecoration: 'none',
      color: 'primary',
    },
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: { _: 56, md: 72 } },
      h2: { fontSize: { _: 40, md: 56 } },
      h3: { fontSize: { _: 24, md: 32 } },
      h4: { fontSize: 20 },
    },
  })
  .groups({ text: true, space: true })
  .asElement('a');

export const ModeToggle = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: 0,
    border: 1,
    borderColor: 'border',
    bg: 'transparent',
    color: 'text',
    cursor: 'pointer',
    fontSize: 18,
    transition: 'border-color 0.15s ease, color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      color: 'primary',
    },
  })
  .asElement('button');

export const GradientBar = ds
  .styles({
    height: '2px',
    borderRadius: 0,
    bg: 'primary',
    boxShadow: '0 0 4px rgba(255,40,0,0.3)',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const HeroSubtitle = ds
  .styles({
    fontFamily: 'body',
    fontSize: { _: 16, md: 18 },
    lineHeight: 'base',
    color: 'textMuted',
    m: 0,
    maxWidth: '36rem',
  })
  .asElement('p');

export const SpecimenRow = ds
  .styles({
    display: 'flex',
    alignItems: 'baseline',
    gap: 16,
    py: 12,
    borderBottom: 1,
    borderColor: 'border',
  })
  .asElement('div');

export const SpecimenSize = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'textMuted',
    minWidth: '5rem',
    letterSpacing: '0.05em',
  })
  .asElement('span');

// ─── Syntax-Highlighted Code Block ───────────────────────────

export { SyntaxBlock as CodeBlock } from './SyntaxBlock';

// ─── Timeline ────────────────────────────────────────────────

export const Timeline = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    gap: 0,
  })
  .asElement('div');

export const TimelineStep = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '3rem 1fr',
    gap: 0,
    position: 'relative',
  })
  .asElement('div');

export const TimelineTrack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
  })
  .asElement('div');

export const TimelineMarker = ds
  .styles({
    width: '2.5rem',
    height: '2.5rem',
    borderRadius: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    position: 'relative',
    zIndex: 1,
    border: 1,
    borderColor: 'primary',
    color: 'primary',
  })
  .groups({ surface: true })
  .asElement('div');

export const TimelineLine = ds
  .styles({
    width: '1px',
    bg: 'primary',
    flexGrow: 1,
    minHeight: '1.5rem',
    opacity: 0.3,
  })
  .asElement('div');

export const TimelineContent = ds
  .styles({ pb: 32, pl: 24 })
  .groups({ space: true })
  .asElement('div');

// ─── Elevation Demo ──────────────────────────────────────────

export const ElevationCard = ds
  .styles({
    bg: 'surface',
    borderRadius: 0,
    border: 1,
    borderColor: 'border',
    p: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('div');

// ─── Media Frame ─────────────────────────────────────────────

export const MediaFrame = ds
  .styles({
    width: 1,
    bg: 'backgroundMuted',
    borderRadius: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 1,
    borderColor: 'border',
    fontFamily: 'mono',
    fontSize: 14,
    color: 'textMuted',
  })
  .groups({ arrange: true, surface: true })
  .asElement('div');

// ─── Fluid Heading ───────────────────────────────────────────

export const FluidHeading = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 800,
    lineHeight: 'none',
    letterSpacing: '-0.02em',
    textTransform: 'uppercase',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, space: true })
  .asElement('h2');

// ─── Focus Demo ──────────────────────────────────────────────

export const FocusBox = ds
  .styles({
    bg: 'surface',
    borderRadius: 0,
    p: 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s ease',
    border: 1,
    borderColor: 'border',
    fontFamily: 'mono',
    fontSize: 14,
    color: 'text',
    '&:focus': {
      outline: 'none',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('button');
