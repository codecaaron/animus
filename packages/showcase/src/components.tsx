/**
 * All showcase components use the custom `ds` instance.
 * Groups: surface, arrange, text, motion, space, positioning
 */
import { ds } from './custom-vocabulary';

// ─── Primitives ──────────────────────────────────────────────

export const Box = ds
  .styles({ display: 'block' })
  .groups({
    space: true,
    surface: true,
    arrange: true,
  })
  .asElement('div');

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const Row = ds
  .styles({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
  })
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
  .styles({
    py: { _: 48, md: 96 },
  })
  .groups({ surface: true, space: true })
  .asElement('section');

// ─── Typography ──────────────────────────────────────────────

export const Heading = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 400,
    lineHeight: 'tight',
    color: 'text',
    m: 0,
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: { _: 48, md: 64 } },
      h2: { fontSize: { _: 36, md: 48 } },
      h3: { fontSize: { _: 24, md: 30 } },
      h4: { fontSize: 20 },
    },
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('h2');

export const Text = ds
  .styles({
    fontFamily: 'base',
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
    color: 'accent',
    px: 8,
    py: 2,
    borderRadius: 4,
    lineHeight: 'base',
  })
  .asElement('code');

export const Label = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.08em',
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
    fontFamily: 'base',
    fontWeight: 600,
    lineHeight: 'snug',
    cursor: 'pointer',
    borderRadius: 8,
    border: 'none',
    transition: 'all 0.15s ease',
    '&:hover': {
      opacity: 0.88,
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
        fontSize: 16,
      },
      secondary: {
        bg: 'accent',
        color: 'background',
        px: 24,
        py: 12,
        fontSize: 16,
      },
      ghost: {
        bg: 'transparent',
        color: 'primary',
        border: 1,
        borderColor: 'border',
        px: 24,
        py: 12,
        fontSize: 16,
        '&:hover': {
          bg: 'backgroundMuted',
          opacity: 1,
        },
      },
      small: {
        bg: 'primary',
        color: 'background',
        px: 16,
        py: 8,
        fontSize: 14,
        borderRadius: 4,
      },
    },
  })
  .states({
    disabled: {
      opacity: 0.4,
      cursor: 'not-allowed',
    },
  })
  .groups({ space: true })
  .asElement('button');

// ─── Surfaces ──────────────────────────────────────────────

export const Card = ds
  .styles({
    bg: 'surface',
    borderRadius: 12,
    border: 1,
    borderColor: 'border',
    p: 24,
    display: 'flex',
    flexDirection: 'column',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
    '&:hover': {
      borderColor: 'borderStrong',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    },
  })
  .states({
    interactive: {
      cursor: 'pointer',
      '&:hover': {
        borderColor: 'primary',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
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
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.04em',
    borderRadius: 'full',
    lineHeight: 'snug',
  })
  .variant({
    defaultVariant: 'default',
    variants: {
      default: {
        bg: 'backgroundMuted',
        color: 'textMuted',
        px: 12,
        py: 4,
      },
      primary: {
        bg: 'primary',
        color: 'background',
        px: 12,
        py: 4,
      },
      accent: {
        bg: 'accent',
        color: 'background',
        px: 12,
        py: 4,
      },
      success: {
        bg: 'success',
        color: 'background',
        px: 12,
        py: 4,
      },
      warning: {
        bg: 'warning',
        color: 'background',
        px: 12,
        py: 4,
      },
    },
  })
  .asElement('span');

export const Divider = ds
  .styles({
    border: 'none',
    height: '1px',
    m: 0,
    background:
      'linear-gradient(90deg, transparent, #6366f1, #8b5cf6, #ec4899, transparent)',
    opacity: 0.3,
  })
  .groups({ space: true })
  .asElement('hr');

// ─── Extension Chains ────────────────────────────────────────

export const SmallButton = Button.extend()
  .styles({
    px: 12,
    py: 4,
    fontSize: 12,
    borderRadius: 4,
    fontWeight: 500,
  })
  .asElement('button');

export const FeatureCard = Card.extend()
  .styles({
    p: 32,
    gap: 16,
  })
  .asElement('div');

export const ColorSwatch = ds
  .styles({
    width: '3rem',
    height: '3rem',
    borderRadius: 8,
    border: 1,
    borderColor: 'border',
  })
  .groups({ surface: true })
  .asElement('div');

// ─── App-Level Components ────────────────────────────────────

export const AppShell = ds
  .styles({
    minHeight: '100vh',
    fontFamily: 'base',
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
    fontWeight: 700,
    letterSpacing: '2px',
    textTransform: 'capitalize',
    background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899, #6366f1)',
    backgroundSize: '400px 100%',
    backgroundClip: 'text',
    color: 'transparent',
    animation: 'flow 5s linear infinite',
    cursor: 'default',
    '&:hover': {
      animationPlayState: 'paused',
    },
  })
  .asElement('span');

// Anchor heading: solid foreground clips over chromatic shadow on hover
export const AnchorHeading = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 400,
    lineHeight: 'tight',
    color: 'text',
    m: 0,
    textDecoration: 'none',
    textShadow: 'none',
    transition: 'text-shadow 0.2s ease',
    cursor: 'pointer',
    '&:hover': {
      textDecoration: 'none',
      textShadow:
        '0.03em 0.03em #6366f1, 0.06em 0.06em #8b5cf6, 0.09em 0.09em #ec4899',
    },
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: { _: 48, md: 64 } },
      h2: { fontSize: { _: 36, md: 48 } },
      h3: { fontSize: { _: 24, md: 30 } },
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
    borderRadius: 8,
    border: 1,
    borderColor: 'border',
    bg: 'transparent',
    color: 'text',
    cursor: 'pointer',
    fontSize: 18,
    transition: 'border-color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
    },
  })
  .asElement('button');

export const GradientBar = ds
  .styles({
    height: '4px',
    borderRadius: 'full',
    backgroundImage: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899)',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const HeroSubtitle = ds
  .styles({
    fontFamily: 'base',
    fontSize: { _: 18, md: 20 },
    lineHeight: 'loose',
    color: 'textMuted',
    m: 0,
    maxWidth: '38rem',
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
    fontSize: 12,
    color: 'textMuted',
    minWidth: '5rem',
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
    borderRadius: 'full',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
    position: 'relative',
    zIndex: 1,
  })
  .groups({ surface: true })
  .asElement('div');

export const TimelineLine = ds
  .styles({
    width: '2px',
    bg: 'border',
    flexGrow: 1,
    minHeight: '1.5rem',
  })
  .asElement('div');

export const TimelineContent = ds
  .styles({
    pb: 32,
    pl: 24,
  })
  .groups({ space: true })
  .asElement('div');

// ─── Media Frame ─────────────────────────────────────────────

export const MediaFrame = ds
  .styles({
    width: 1,
    bg: 'backgroundMuted',
    borderRadius: 8,
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
    fontWeight: 400,
    lineHeight: 'tight',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, space: true })
  .asElement('h2');

// ─── Focus Demo ──────────────────────────────────────────────

export const FocusBox = ds
  .styles({
    bg: 'surface',
    borderRadius: 8,
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
