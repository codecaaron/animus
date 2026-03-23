/**
 * ANIMUS — Forge Narrative Components
 *
 * Purpose-built for the showcase polemic. Every component name
 * carries intent. The API IS the voice.
 *
 * Aesthetic: Tartakovsky's Primal + Icecrown Soul Forge + Dostoevsky Underground
 */
import { ds } from './ds';

// ─── Layout Primitives ──────────────────────────────────────

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
    maxWidth: '64rem',
    mx: 'auto',
    px: { _: 16, sm: 24, md: 48 },
  })
  .asElement('div');

export const Section = ds
  .styles({ py: { _: 48, md: 96 } })
  .groups({ surface: true, space: true })
  .asElement('section');

// ─── Typography Primitives ──────────────────────────────────

export const Text = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'base',
    color: 'text',
    m: 0,
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

// ─── App Shell ──────────────────────────────────────────────

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
    justifyContent: 'flex-end',
    alignItems: 'center',
    py: 16,
  })
  .asElement('nav');

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

// ─── I. THE VOID ────────────────────────────────────────────

export const VoidFrame = ds
  .styles({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '80vh',
    bg: 'background',
    overflow: 'hidden',
    animation: 'void-pulse 6s ease-in-out infinite',
  })
  .groups({ space: true })
  .asElement('div');

export const VoidSignature = ds
  .styles({
    fontFamily: 'logo',
    fontSize: { _: 36, md: 56 },
    fontWeight: 400,
    letterSpacing: '0.3em',
    textTransform: 'lowercase',
    color: 'primary',
    m: 0,
    lineHeight: 'none',
    animation: 'ember 4s ease-in-out infinite',
    cursor: 'default',
    userSelect: 'none',
  })
  .asElement('h1');

export const VoidWhisper = ds
  .styles({
    fontFamily: 'body',
    fontSize: 12,
    letterSpacing: '0.4em',
    textTransform: 'uppercase',
    color: 'textMuted',
    m: 0,
    mt: 24,
    lineHeight: 'none',
    opacity: 0.5,
  })
  .asElement('p');

// ─── II. THE INDICTMENT ─────────────────────────────────────

export const IndictmentBlock = ds
  .styles({
    fontFamily: 'body',
    fontSize: { _: 15, md: 16 },
    lineHeight: 'loose',
    color: 'text',
    m: 0,
    borderLeft: 4,
    borderColor: 'primary',
    pl: 32,
    py: 24,
  })
  .groups({ space: true, surface: true })
  .asElement('blockquote');

export const IndictmentLine = ds
  .styles({
    display: 'block',
    opacity: 0,
    animation: 'burn-in 0.5s ease-out both',
    mb: 4,
    '&:hover': {
      color: 'primary',
      transition: 'color 0.15s ease',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('span');

export const IndictmentEmphasis = ds
  .styles({
    display: 'block',
    fontFamily: 'mono',
    fontSize: { _: 11, md: 12 },
    lineHeight: 'base',
    color: 'textMuted',
    bg: 'backgroundMuted',
    px: 16,
    py: 12,
    my: 16,
    borderRadius: 0,
    overflowX: 'auto',
    whiteSpace: 'pre',
    opacity: 0,
    animation: 'burn-in 0.5s ease-out both',
  })
  .asElement('code');

export const IndictmentVerdict = ds
  .styles({
    display: 'block',
    fontWeight: 700,
    color: 'primary',
    mt: 16,
    opacity: 0,
    animation: 'burn-in 0.5s ease-out both',
  })
  .groups({ surface: true })
  .asElement('span');

// ─── III. SECTION SCAR ──────────────────────────────────────

export const ScarContainer = ds
  .styles({
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    my: { _: 48, md: 64 },
  })
  .groups({ space: true })
  .asElement('div');

export const ScarChapter = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'primary',
    lineHeight: 'none',
    flexShrink: 0,
  })
  .asElement('span');

export const ScarLine = ds
  .styles({
    flexGrow: 1,
    height: '1px',
    bg: 'primary',
    boxShadow: '0 0 4px rgba(255,40,0,0.3)',
    animation: 'scar-draw 0.8s ease-out both',
    transformOrigin: 'left',
  })
  .asElement('div');

export const ScarTitle = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'textMuted',
    lineHeight: 'none',
    flexShrink: 0,
  })
  .asElement('span');

// ─── IV. THE FORGE ──────────────────────────────────────────

export const ForgeBench = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: { _: '1fr', md: '1fr auto 1fr' },
    gap: 0,
    bg: 'backgroundMuted',
    border: 1,
    borderColor: 'border',
    position: 'relative',
    '&:hover': {
      borderColor: 'primary',
      transition: 'border-color 0.15s ease',
    },
  })
  .groups({ space: true })
  .asElement('div');

export const ForgeInput = ds
  .styles({
    p: { _: 24, md: 32 },
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    opacity: 0.6,
    transition: 'opacity 0.15s ease',
    '&:hover': {
      opacity: 1,
    },
  })
  .groups({ surface: true, space: true })
  .asElement('div');

export const ForgeOutput = ds
  .styles({
    p: { _: 24, md: 32 },
    bg: 'surface',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  })
  .groups({ surface: true, space: true })
  .asElement('div');

export const ForgeScar = ds
  .styles({
    display: { _: 'none', md: 'flex' },
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2px',
    position: 'relative',
    bg: 'primary',
    boxShadow: '0 0 8px rgba(255,40,0,0.4), 0 0 24px rgba(255,40,0,0.1)',
  })
  .asElement('div');

export const ForgeScarGlyph = ds
  .styles({
    position: 'absolute',
    fontFamily: 'mono',
    fontSize: 18,
    color: 'primary',
    bg: 'backgroundMuted',
    px: 8,
    py: 4,
    lineHeight: 'none',
    userSelect: 'none',
  })
  .asElement('span');

export const ForgeLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'textMuted',
    lineHeight: 'none',
  })
  .asElement('span');

// ─── V. THE PROOF ───────────────────────────────────────────

export const ProofSpecimen = ds
  .styles({
    bg: 'backgroundMuted',
    border: 1,
    borderColor: 'border',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gap: 0,
    transition: 'border-color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
    },
  })
  .groups({ space: true, surface: true })
  .asElement('div');

export const ProofStage = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: 48,
    bg: 'surface',
    borderBottom: 1,
    borderColor: 'border',
    minHeight: '120px',
    gap: 12,
    flexWrap: 'wrap',
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');

export const ProofMeta = ds
  .styles({
    p: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  })
  .groups({ space: true })
  .asElement('div');

export const ProofHash = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'primary',
    letterSpacing: '0.05em',
    lineHeight: 'none',
  })
  .asElement('code');

export const ProofLayer = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    lineHeight: 'snug',
    display: 'inline-flex',
    alignItems: 'center',
    px: 6,
    py: 2,
    border: 1,
    borderColor: 'primary',
    color: 'primary',
  })
  .asElement('span');

// ─── VI. CODE ALTAR ─────────────────────────────────────────

export const CodeAltarFrame = ds
  .styles({
    position: 'relative',
    bg: 'backgroundMuted',
    border: 1,
    borderColor: 'border',
    borderLeft: 4,
    borderLeftColor: 'primary',
    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      boxShadow: '0 0 8px rgba(255,40,0,0.15)',
    },
  })
  .groups({ space: true })
  .asElement('div');

export const AltarHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 24,
    py: 12,
    borderBottom: 1,
    borderColor: 'border',
  })
  .asElement('div');

export const AltarFile = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.1em',
    color: 'textMuted',
    lineHeight: 'none',
  })
  .asElement('span');

export const AltarLang = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'primary',
    lineHeight: 'none',
  })
  .asElement('span');

export const AltarSurround = ds
  .styles({
    py: { _: 32, md: 48 },
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  })
  .groups({ space: true })
  .asElement('div');

export const AltarCaption = ds
  .styles({
    fontFamily: 'body',
    fontSize: 14,
    lineHeight: 'loose',
    color: 'textMuted',
    mt: 16,
    pl: 24,
    borderLeft: 1,
    borderColor: 'border',
    maxWidth: '48rem',
    m: 0,
  })
  .asElement('p');

// ─── VII. EMBER GLYPH ──────────────────────────────────────

export const EmberGlyph = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'primary',
    animation: 'ember 3s ease-in-out infinite',
    lineHeight: 'none',
    userSelect: 'none',
    cursor: 'default',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 24 },
      md: { fontSize: 40 },
      lg: { fontSize: 64 },
      xl: { fontSize: 96 },
    },
  })
  .groups({ space: true, positioning: true })
  .asElement('div');

// ─── VIII. VERDICT LINE ─────────────────────────────────────

export const VerdictLine = ds
  .styles({
    fontFamily: 'heading',
    fontWeight: 800,
    lineHeight: 'none',
    letterSpacing: '-0.02em',
    textTransform: 'uppercase',
    color: 'primary',
    m: 0,
    py: { _: 48, md: 96 },
    textAlign: 'center',
    animation: 'forge-reveal 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: { _: 40, md: 72 } },
      h2: { fontSize: { _: 32, md: 56 } },
      h3: { fontSize: { _: 24, md: 40 } },
    },
  })
  .groups({ space: true })
  .asElement('h2');

// ─── Buttons (for proof section) ────────────────────────────

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

// ─── Re-export SyntaxBlock ──────────────────────────────────

export { SyntaxBlock as CodeBlock } from './SyntaxBlock';
