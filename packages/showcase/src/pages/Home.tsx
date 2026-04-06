import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  CascadeLayer,
  CodeExample,
  Display,
  FireLine,
  HorizontalMark,
  Label,
  Logo,
  Mono,
  Prose,
  ReadingBarTrack,
  RevealBlock,
  Row,
  Scene,
  Stack,
} from '../components';
import { ds } from '../ds';

// ─── Intersection Observer ──────────────────────────────────

let revealCounter = 0;

function Reveal({
  children,
  delay = '0',
  threshold = 0.15,
  ...props
}: {
  children: React.ReactNode;
  delay?: '0' | '1' | '2' | '3' | '4';
  threshold?: number;
} & React.HTMLAttributes<HTMLElement>) {
  const [visible, setVisible] = useState(false);
  const [id] = useState(() => `reveal-${++revealCounter}`);

  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [id, threshold]);

  return (
    <RevealBlock id={id} visible={visible} delay={delay} {...props}>
      {children}
    </RevealBlock>
  );
}

function ReadingBar() {
  const id = 'animus-reading-bar';
  useEffect(() => {
    const handler = () => {
      const el = document.getElementById(id);
      if (!el) return;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = `${(window.scrollY / h) * 100}%`;
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);
  return <ReadingBarTrack id={id} />;
}

// ─── Pillar Components ──────────────────────────────────────

const PillarCard = ds
  .styles({
    flex: '1 1 280px',
    minWidth: '0',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    p: 32,
    border: 1,
    borderColor: '{colors.border/40}',
    transition: 'border-color 0.3s ease, box-shadow 0.4s ease',
  })
  .variant({
    prop: 'accent',
    variants: {
      fire: {
        '&:hover': {
          borderColor: '{colors.primary/70}',
          boxShadow: '0 0 24px {colors.glow/10}, 0 0 4px {colors.glow/20}',
        },
      },
      gold: {
        '&:hover': {
          borderColor: '{colors.accent/60}',
          boxShadow: '0 0 24px {colors.accent/8}, 0 0 4px {colors.accent/15}',
        },
      },
      warm: {
        '&:hover': {
          borderColor: '{colors.text/25}',
          boxShadow: '0 0 24px {colors.text/5}',
        },
      },
    },
  })
  .asElement('div');

const PillarMark = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 40,
    fontWeight: 300,
    lineHeight: 'none',
    color: 'primary',
    position: 'relative',
    display: 'inline-block',
    pb: 16,
    mb: 4,
    '&::after': {
      content: '""',
      position: 'absolute',
      bottom: '0',
      left: '0',
      width: '20px',
      height: '2px',
      background: '{colors.primary}',
      opacity: '0.3',
    },
  })
  .asElement('span');

// ─── Code Examples ──────────────────────────────────────────

const COMPONENT_SOURCE = `const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    p: 24,
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    transition: 'border-color 0.2s ease',
    '&:hover': { borderColor: 'primary' },
  })
  .variant({
    prop: 'elevation',
    variants: {
      flat:     { boxShadow: '0' },
      raised:   { boxShadow: 'glow-subtle' },
      floating: { boxShadow: 'glow' },
    },
  })
  .states({
    disabled: { opacity: '0.4', pointerEvents: 'none' },
  })
  .system({ space: true, arrange: true })
  .asElement('div');`;

const CSS_OUTPUT = `/* Statically extracted. No runtime serialization. */

@layer base {
  .card-a7x2 {
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    background: var(--color-surface);
    border: 1px solid currentColor;
    border-color: var(--color-border);
    transition: border-color 0.2s ease;
  }
  .card-a7x2:hover {
    border-color: var(--color-primary);
  }
}

@layer variants {
  .card-a7x2--elevation-flat {
    box-shadow: none;
  }
  .card-a7x2--elevation-raised {
    box-shadow: 0 0 4px rgba(255,40,0,0.2);
  }
}

@layer states {
  .card-a7x2--disabled {
    opacity: 0.4;
    pointer-events: none;
  }
}`;

// ─── Cascade Contract ───────────────────────────────────────

const CASCADE_LAYERS = [
  { name: '@layer global', desc: 'Resets. Box-sizing. Body defaults.' },
  { name: '@layer base', desc: 'What the component always looks like.' },
  {
    name: '@layer variants',
    desc: 'Named design decisions. Size, intent, appearance.',
  },
  { name: '@layer compounds', desc: 'Intersections of variant axes.' },
  { name: '@layer states', desc: 'Boolean overrides. Disabled always wins.' },
  { name: '@layer system', desc: 'Callsite props. Responsive by default.' },
  { name: '@layer custom', desc: 'Runtime values. The escape hatch.' },
] as const;

// ─── Feature Pillars Data ───────────────────────────────────

const PILLARS = [
  {
    mark: '{',
    title: 'Zero-Runtime Extraction',
    body: 'Your styles shouldn\u2019t serialize on every render. Animus evaluates builder chains at build time via a Rust pipeline. What ships is a thin React wrapper and pure, static CSS.',
    accent: 'fire' as const,
  },
  {
    mark: '@',
    title: 'The Cascade Contract',
    body: 'Throw away !important. Animus maps base styles, variants, and states to explicit CSS @layer blocks. Precedence is guaranteed by layer order, not selector specificity.',
    accent: 'gold' as const,
  },
  {
    mark: '.',
    title: 'Type-State Builder Chain',
    body: 'The API prevents invalid CSS before you hit save. The builder chain is a type-state machine that enforces cascade ordering, validates token references, and narrows variant props in your IDE.',
    accent: 'warm' as const,
  },
] as const;

// ─── App ────────────────────────────────────────────────────

const logoSize = { _: 'md', md: 'xxl' } as const;

export default function Home() {
  return (
    <>
      <ReadingBar />

      {/* ═══════ I. HERO ═══════ */}
      <Scene py={0} minHeight="100vh">
        <Stack alignItems="center" gap={48}>
          <Reveal>
            <Logo logoSize={logoSize}>Animus</Logo>
          </Reveal>
          <Reveal delay="1">
            <HorizontalMark width="40px" />
          </Reveal>
          <Reveal delay="2">
            <Label
              color="text.dim"
              letterSpacing="0.4em"
              fontSize={11}
              fontWeight={400}
            >
              Not a runtime.
            </Label>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ II. THE HOOK ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto" bg="bg.muted">
        <Stack gap={48} maxWidth="44rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={12}>
            <Reveal>
              <Display fontSize={{ _: 24, md: 48 }} lineHeight="tight">
                The authoring experience of CSS-in-JS.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Display
                fontSize={{ _: 24, md: 48 }}
                lineHeight="tight"
                color="text.muted"
              >
                Zero runtime cost.
              </Display>
            </Reveal>
          </Stack>
          <Reveal delay="2">
            <Prose
              fontSize={{ _: 14, md: 16 }}
              lineHeight="relaxed"
              maxWidth="38rem"
              color="text.muted"
            >
              Animus is a strict, type-safe styling compiler for React. Write
              the variant-driven components you love. A Rust-based pipeline
              extracts them into static, layered CSS. Fully compatible with
              React Server Components.
            </Prose>
          </Reveal>
          <Reveal delay="3">
            <Row gap={24} flexWrap="wrap">
              <Link to="/docs/start" style={{ textDecoration: 'none' }}>
                <Mono fontSize={14} color="primary">
                  Get started →
                </Mono>
              </Link>
              <Link to="/docs" style={{ textDecoration: 'none' }}>
                <Mono fontSize={14} color="text.dim">
                  Why Animus?
                </Mono>
              </Link>
            </Row>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ III. FEATURE PILLARS ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto">
        <Stack gap={48} maxWidth="64rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Row gap={{ _: 24, md: 32 }} flexWrap="wrap" alignItems="stretch">
            {PILLARS.map(({ mark, title, body, accent }, i) => (
              <Reveal
                key={title}
                delay={`${i}` as '0' | '1' | '2'}
                style={{ flex: '1 1 280px', minWidth: 0, display: 'flex' }}
              >
                <PillarCard accent={accent}>
                  <PillarMark>{mark}</PillarMark>
                  <Display fontSize={{ _: 18, md: 24 }} lineHeight="tight">
                    {title}
                  </Display>
                  <Prose
                    fontSize={14}
                    lineHeight="relaxed"
                    color="text.muted"
                  >
                    {body}
                  </Prose>
                </PillarCard>
              </Reveal>
            ))}
          </Row>
        </Stack>
      </Scene>

      <FireLine />

      {/* ═══════ IV. WHAT YOU WRITE / WHAT SHIPS ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto">
        <Stack gap={48} maxWidth="44rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={16}>
            <Reveal>
              <Display fontSize={{ _: 20, md: 32 }} lineHeight="tight">
                What you write. What ships.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                maxWidth="36rem"
                color="text.muted"
              >
                The builder chain declares every possible output —
                variants, states, responsive overrides — as a finite tree.
                A Rust compiler walks every branch, resolves every token, and
                emits static CSS. What remains at runtime is class selection.
              </Prose>
            </Reveal>
          </Stack>

          <Reveal delay="2">
            <CodeExample input={COMPONENT_SOURCE} output={CSS_OUTPUT} />
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ V. THE CONTRACT ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto" bg="bg.muted">
        <Stack gap={64} maxWidth="44rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={16}>
            <Reveal>
              <Display fontSize={{ _: 20, md: 32 }} lineHeight="tight">
                The cascade is a contract.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                maxWidth="34rem"
                color="text.muted"
              >
                Each builder method maps to a layer. Layer position determines
                precedence — not selectors, not source order, not
                !important.
              </Prose>
            </Reveal>
          </Stack>

          <Reveal delay="2">
            <Stack gap={2}>
              {CASCADE_LAYERS.map(({ name, desc }, i) => (
                <CascadeLayer
                  key={name}
                  depth={`${i + 1}` as `${1 | 2 | 3 | 4 | 5 | 6 | 7}`}
                >
                  <Mono
                    transition="all 2s ease-in"
                    fontSize={13}
                    fontWeight={500}
                    color="primary"
                    letterSpacing="0.02em"
                  >
                    {name}
                  </Mono>
                  <Mono fontSize={12} color="text.dim">
                    {desc}
                  </Mono>
                </CascadeLayer>
              ))}
            </Stack>
          </Reveal>

          <Reveal delay="3">
            <Prose fontSize={14} lineHeight="relaxed" color="text.dim">
              A state always beats a variant. A system prop always beats a
              base style. The ordering is explicit and static.
            </Prose>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ VI. CTA ═══════ */}
      <Scene py={{ _: 128, md: 160 }} minHeight="auto">
        <Stack gap={48} maxWidth="44rem" mx="auto" alignItems="center" px={24}>
          <Reveal>
            <Mono
              fontSize={{ _: 13, md: 14 }}
              color="text.muted"
              letterSpacing="0.05em"
              bg="surface"
              px={20}
              py={8}
              border={1}
              borderColor="border"
            >
              bun add @animus-ui/system
            </Mono>
          </Reveal>
          <Reveal delay="1">
            <HorizontalMark width="40px" />
          </Reveal>
          <Reveal delay="2">
            <Stack gap={16} alignItems="center">
              <Link to="/docs/start" style={{ textDecoration: 'none' }}>
                <Mono fontSize={16} color="primary" fontWeight={500}>
                  Get started →
                </Mono>
              </Link>
              <Link to="/docs" style={{ textDecoration: 'none' }}>
                <Mono fontSize={14} color="text.muted">
                  Read the philosophy
                </Mono>
              </Link>
            </Stack>
          </Reveal>
        </Stack>
      </Scene>
    </>
  );
}
