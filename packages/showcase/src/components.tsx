import { ds } from './ds';
// ─── Primitives ─────────────────────────────────────────────

export const Scene = ds
  .styles({
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('section');

export const Slab = ds
  .styles({
    width: '100%',
    maxWidth: '72rem',
    mx: 'auto',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .groups({ space: true, arrange: true, surface: true })
  .asElement('div');

export const Row = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
  })
  .groups({ space: true, arrange: true, surface: true })
  .asElement('div');

export const Display = ds
  .styles({
    fontFamily: 'display',
    fontWeight: 400,
    lineHeight: 'none',
    letterSpacing: '-0.03em',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true, motion: true })
  .asElement('h1');

export const Prose = ds
  .styles({
    fontFamily: 'body',
    fontWeight: 300,
    lineHeight: 'relaxed',
    color: 'textMuted',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true, arrange: true })
  .asElement('p');

export const Mono = ds
  .styles({
    fontFamily: 'mono',
    fontWeight: 400,
    lineHeight: 'snug',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('span');

export const Label = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'textMuted',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true, arrange: true })
  .asElement('span');

export const CodeBlock = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    lineHeight: 'relaxed',
    bg: 'carbon',
    color: 'bone',
    border: 1,
    borderColor: 'ash',
    borderRadius: 0,
    p: 32,
    m: 0,
    overflow: 'auto',
    whiteSpace: 'pre',
  })
  .groups({ space: true, surface: true })
  .asElement('pre');

export const Divider = ds
  .styles({
    width: '1px',
    bg: 'ash',
    border: 'none',
    mx: 'auto',
  })
  .groups({ space: true, arrange: true })
  .asElement('hr');

export const Accent = ds
  .styles({
    color: 'primary',
    fontStyle: 'italic',
  })
  .asElement('em');

export const Strong = ds
  .styles({
    color: 'text',
    fontWeight: 400,
  })
  .asElement('strong');

export const SectionLabel = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'accent',
    pl: 24,
    position: 'relative',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('div');

export const Callout = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 500,
    bg: 'primary',
    color: 'void',
    p: 16,
    m: 0,
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('div');

export const StratumRow = ds
  .styles({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    p: 16,
    borderLeft: 3,
    borderColor: 'ash',
    transition: 'border-color 0.3s ease, background 0.15s ease',
    '&:hover': {
      borderColor: 'accent',
      bg: 'rgba(255,182,39,0.03)',
    },
  })
  .variant({
    prop: 'kind',
    variants: {
      default: {},
      terminal: {
        borderColor: 'primary',
        bg: 'rgba(255,40,0,0.06)',
      },
    },
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');

export const EmberDivider = ds
  .styles({
    width: '100%',
    maxWidth: '48rem',
    mx: 'auto',
    py: 48,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  })
  .asElement('div');

export const ReadingBarTrack = ds
  .styles({
    position: 'fixed',
    bottom: 0,
    left: 0,
    height: '3px',
    width: '0%',
    bg: 'primary',
    boxShadow: '0 0 12px rgba(255,40,0,0.6)',
    zIndex: 200,
    pointerEvents: 'none',
  })
  .asElement('div');

// Decorative marks — the visual punctuation of the forge

export const GoldDash = ds
  .styles({
    width: '12px',
    height: '3px',
    bg: 'accent',
    flexShrink: 0,
  })
  .asElement('div');

export const GradientBar = ds
  .styles({
    width: '60px',
    height: '2px',
    background: 'linear-gradient(90deg, #C1121F, #FFB627)',
    boxShadow: '0 0 8px rgba(255,182,39,0.2)',
  })
  .asElement('div');

export const VerticalBleed = ds
  .styles({
    width: '3px',
    bg: 'primary',
    boxShadow: '0 0 8px rgba(255,40,0,0.3)',
  })
  .groups({ space: true, arrange: true, surface: true })
  .asElement('div');

export const HorizontalMark = ds
  .styles({
    height: '3px',
    bg: 'primary',
    boxShadow: '0 0 12px rgba(255,40,0,0.5)',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');

export const RevealBlock = ds
  .styles({
    opacity: '0',
    transform: 'translateY(24px)',
    transition:
      'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
  })
  .variant({
    prop: 'delay',
    variants: {
      0: {},
      1: { transitionDelay: '0.15s' },
      2: { transitionDelay: '0.3s' },
      3: { transitionDelay: '0.45s' },
      4: { transitionDelay: '0.6s' },
    },
  })
  .states({
    visible: {
      opacity: '1',
      transform: 'translateY(0)',
    },
  })
  .asElement('div');
