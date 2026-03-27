import { useEffect, useState } from 'react';

import {
  Accent,
  CodeFrame,
  Display,
  EmberDivider,
  FireLine,
  GlowText,
  GradientBar,
  HorizontalMark,
  Label,
  Logo,
  Mono,
  Prose,
  ReadingBarTrack,
  RevealBlock,
  Row,
  Scene,
  SectionLabel,
  Slab,
  Stack,
  StratumRow,
  SyntaxBlock,
} from './components';

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
  .groups({ space: true, arrange: true })
  .asElement('div');`;

const CSS_OUTPUT = `/* What ships. Zero JavaScript. */

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
  .card-a7x2--elevation-floating {
    box-shadow: 0 0 8px rgba(255,40,0,0.4),
                0 0 24px rgba(255,40,0,0.1);
  }
}

@layer states {
  .card-a7x2--disabled {
    opacity: 0.4;
    pointer-events: none;
  }
}`;

// ─── App ────────────────────────────────────────────────────
const logoSize = { _: 'md', md: 'xxl' } as const;
export default function App() {
  return (
    <>
      <ReadingBar />

      {/* ═══════ I. HERO ═══════ */}
      <Scene py={0} minHeight="100vh">
        <Stack alignItems="center" gap={32}>
          <Reveal>
            <Logo logoSize={logoSize}>Animus</Logo>
            <Logo logoSize={'xs'}>Animus</Logo>
          </Reveal>
          <Reveal delay="1">
            <Label
              color="accent"
              letterSpacing="0.3em"
              fontSize={11}
              fontWeight={500}
            >
              Write components. Ship CSS.
            </Label>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ II. EXTRACTION ═══════ */}
      <Scene py={96} minHeight="auto" bg="backgroundMuted">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={64} maxWidth="48rem" mx="auto">
            <Stack gap={32}>
              <Reveal>
                <SectionLabel>Extraction</SectionLabel>
              </Reveal>
              <Reveal delay="1">
                <Display fontSize={{ _: 24, md: 48 }} lineHeight="tight">
                  The surface is <Accent>authored.</Accent>
                </Display>
              </Reveal>
              <Reveal delay="2">
                <Display fontSize={{ _: 24, md: 48 }} lineHeight="tight">
                  The substrate <Accent>ships.</Accent>
                </Display>
              </Reveal>
              <Reveal delay="3">
                <Prose
                  fontSize={{ _: 14, md: 16 }}
                  lineHeight="relaxed"
                  maxWidth="36rem"
                >
                  You write TypeScript. A Rust pipeline built on OXC walks every
                  builder chain, resolves every variant and state against your
                  design tokens, and emits atomic CSS. The JavaScript
                  disappears.
                </Prose>
              </Reveal>
            </Stack>

            <Stack gap={16}>
              <Reveal>
                <Label color="textMuted" mb={8}>
                  the surface
                </Label>
              </Reveal>
              <Reveal delay="1">
                <CodeFrame>
                  <SyntaxBlock language="tsx">{COMPONENT_SOURCE}</SyntaxBlock>
                </CodeFrame>
              </Reveal>
            </Stack>

            <Reveal>
              <Row justifyContent="center">
                <GradientBar />
              </Row>
            </Reveal>

            <Stack gap={16}>
              <Reveal>
                <Label color="textMuted" mb={8}>
                  the substrate
                </Label>
              </Reveal>
              <Reveal delay="1">
                <CodeFrame>
                  <SyntaxBlock language="css">{CSS_OUTPUT}</SyntaxBlock>
                </CodeFrame>
              </Reveal>
            </Stack>
          </Stack>
        </Slab>
      </Scene>

      <EmberDivider />

      {/* ═══════ III. DUALITY ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>Duality</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Mono fontSize={{ _: 24, md: 48 }} lineHeight="tight">
                It's called <GlowText fontWeight={700}>cascading</GlowText>{' '}
                style sheets
              </Mono>
            </Reveal>
            <Reveal delay="2">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                maxWidth="36rem"
              >
                Each method in the builder chain maps to a CSS{' '}
                <Mono fontSize={14} color="primary">
                  @layer
                </Mono>
                . The TypeScript you author and the CSS that ships operate on
                separate planes. They look unified. They are fundamentally
                independent.
              </Prose>
            </Reveal>

            <Reveal delay="3">
              <Stack gap={0}>
                {[
                  {
                    method: '.styles()',
                    layer: '@layer base',
                    desc: '',
                  },
                  {
                    method: '.variant()',
                    layer: '@layer variants',
                    desc: '',
                  },
                  {
                    method: '.states()',
                    layer: '@layer states',
                    desc: '',
                  },
                  {
                    method: '.groups()',
                    layer: '@layer system',
                    desc: '',
                  },
                  {
                    method: '.asElement()',
                    layer: 'sealed',
                    desc: '',
                  },
                ].map((s, i) => (
                  <StratumRow
                    key={s.method}
                    kind={
                      (
                        [
                          'base',
                          'variants',
                          'states',
                          'groups',
                          'terminal',
                        ] as const
                      )[i]!
                    }
                    borderBottom={i < 4 ? 1 : undefined}
                    borderColorBottom={'ash'}
                    px={24}
                  >
                    <Mono
                      fontSize={{ _: 16, md: 20 }}
                      fontWeight={500}
                      color="primary"
                    >
                      {s.method}
                    </Mono>
                    <Prose
                      fontSize={13}
                      color="smoke"
                      m={0}
                      display={{ _: 'none', sm: 'block' }}
                      textAlign="right"
                    >
                      {s.desc}
                    </Prose>
                    <Label
                      color={i === 4 ? 'primary' : 'accent'}
                      flexShrink={0}
                    >
                      {s.layer}
                    </Label>
                  </StratumRow>
                ))}
              </Stack>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      {/* ═══════ threshold ═══════ */}
      <FireLine />

      {/* ═══════ IV. REBIRTH ═══════ */}
      <Scene py={128} minHeight="auto" bg="coal" data-color-mode="dark">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto" alignItems="center">
            <Reveal>
              <SectionLabel color="ember">Rebirth</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Mono
                mr={4}
                fontSize={{ _: 32, md: 48 }}
                fontWeight={700}
                fontFamily={'logo'}
              >
                css-in-js
              </Mono>
              {'  '}

              <Mono fontSize={{ _: 24, md: 32 }} fontFamily={'logo'}>
                is dead
              </Mono>
            </Reveal>
            <Reveal delay="2">
              <Mono mr={4} fontSize={{ _: 24, md: 32 }} fontFamily={'logo'}>
                long live
              </Mono>
              {'  '}
              <GlowText fontSize={{ _: 32, md: 48 }}>css-in-ts</GlowText>
            </Reveal>
            <Reveal delay="3">
              <HorizontalMark width="60px" />
            </Reveal>
            <Reveal delay="4">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                color="fog"
                textAlign="center"
                maxWidth="36rem"
              >
                The libraries that defined a generation of frontend development
                went silent. Animus is what crawled back out. Not a
                runtime&mdash;a compiler.
              </Prose>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      {/* ═══════ V. CODA ═══════ */}
      <Scene py={128} minHeight="80vh" bg="void" data-color-mode="dark">
        <Stack alignItems="center" gap={48} maxWidth="42rem" px={24}>
          <Reveal>
            <Row gap={64} justifyContent="center">
              <Stack alignItems="center" gap={8}>
                <Display
                  fontSize={{ _: 56, md: 96 }}
                  color="primary"
                  lineHeight="none"
                  fontFamily={'logo'}
                  animation="ember 3s ease-in-out infinite, tally-pulse 2s ease-in-out infinite"
                >
                  0
                </Display>
                <Label fontSize={11}>runtime</Label>
              </Stack>
              <Stack alignItems="center" gap={8}>
                <Display
                  fontSize={{ _: 56, md: 96 }}
                  color="primary"
                  lineHeight="none"
                  fontFamily={'logo'}
                  animation="ember 3s ease-in-out infinite, tally-pulse 2s ease-in-out infinite"
                >
                  0
                </Display>
                <Label fontSize={11}>style recalc</Label>
              </Stack>
            </Row>
          </Reveal>
          <Reveal delay="1">
            <HorizontalMark width="60px" />
          </Reveal>
          <Reveal delay="2">
            <Display
              fontSize={{ _: 24, md: 24 }}
              lineHeight="snug"
              textAlign="center"
              fontFamily={'mono'}
            >
              The expressiveness was never the problem.
            </Display>
          </Reveal>
          <Reveal delay="3">
            <Display
              fontSize={{ _: 24, md: 40 }}
              lineHeight="snug"
              textAlign="center"
              fontFamily={'mono'}
            >
              The runtime was.
            </Display>
          </Reveal>
          <Reveal delay="4">
            <Logo logoSize={{ _: 'sm', md: 'md'}}>Animus</Logo>
          </Reveal>
        </Stack>
      </Scene>
    </>
  );
}
