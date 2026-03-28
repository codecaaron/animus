import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  CodeExample,
  Display,
  FireLine,
  GlowText,
  HorizontalMark,
  Label,
  Logo,
  Mono,
  Prose,
  ReadingBarTrack,
  RevealBlock,
  Scene,
  Stack,
} from '../components';

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
}

@layer states {
  .card-a7x2--disabled {
    opacity: 0.4;
    pointer-events: none;
  }
}`;

// ─── App ────────────────────────────────────────────────────
const logo = 'logo' as const;
const cool = 'cool' as const;
const logoSize = { _: 'md', md: 'xxl' } as const;
export default function Home() {
  return (
    <>
      <ReadingBar />

      {/* ═══════ I. HERO ═══════ */}
      <Scene py={0} minHeight="100vh">
        <Stack alignItems="center" gap={32}>
          <Reveal>
            <Logo logoSize={logoSize}>
              <Logo logoSize={'xs'} as="span">
                re
              </Logo>
              Animus
            </Logo>
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
      <Scene py={96} minHeight="auto" bg="bg-muted">
        <Stack gap={64} maxWidth="48rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={32}>
            <Reveal>
              <Display fontSize={{ _: 24, md: 40 }} lineHeight="tight">
                You write TypeScript.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 24, md: 40 }} lineHeight="tight">
                A Rust pipeline ships CSS.
              </Display>
            </Reveal>
            <Reveal delay="2">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                maxWidth="36rem"
              >
                The builder chain IS the cascade. Every method maps to a CSS
                @layer. OXC walks every chain, resolves every token, and emits
                atomic CSS. The JavaScript disappears.
              </Prose>
            </Reveal>
          </Stack>

          <Reveal>
            <CodeExample input={COMPONENT_SOURCE} output={CSS_OUTPUT} />
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ III. DIFFERENTIATORS ═══════ */}
      <Scene py={96} minHeight="auto">
        <Stack gap={48} maxWidth="48rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Reveal>
            <Display fontSize={{ _: 20, md: 32 }} lineHeight="tight">
              Why this.
            </Display>
          </Reveal>
          <Stack gap={32}>
            {[
              [
                'Zero runtime',
                'No style injection. No serialization. No recalc. Platform CSS only.',
              ],
              [
                'Type-safe tokens',
                'Your IDE knows every valid color, every spacing value, every breakpoint.',
              ],
              [
                'Cascade layers',
                'Seven @layers. Flat specificity. Position determines precedence.',
              ],
              [
                'Rust extraction',
                'OXC-based AST analysis. Millisecond builds. Deterministic output.',
              ],
              [
                'Design tokens',
                'Scales, color modes, token aliasing. One file, one truth.',
              ],
            ].map(([title, desc], i) => (
              <Reveal
                key={title}
                delay={String(Math.min(i, 4)) as '0' | '1' | '2' | '3' | '4'}
              >
                <Stack gap={4}>
                  <Mono fontSize={14} fontWeight={500} color="primary">
                    {title}
                  </Mono>
                  <Prose fontSize={14} lineHeight="relaxed" m={0}>
                    {desc}
                  </Prose>
                </Stack>
              </Reveal>
            ))}
          </Stack>
        </Stack>
      </Scene>

      <FireLine />

      {/* ═══════ IV. CTA ═══════ */}
      <Scene py={128} minHeight="auto" bg="bg-muted">
        <Stack gap={48} maxWidth="48rem" mx="auto" alignItems="center" px={24}>
          <Reveal>
            <Mono
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
          <Reveal delay="1">
            <Mono fontSize={{ _: 24, md: 32 }} fontFamily={'logo'}>
              long live
            </Mono>
            {'  '}
            <GlowText variant={logo} test={cool} fontSize={{ _: 32, md: 48 }}>
              css-in-ts
            </GlowText>
          </Reveal>
          <Reveal delay="2">
            <HorizontalMark width="60px" />
          </Reveal>
          <Reveal delay="3">
            <Stack gap={16} alignItems="center">
              <Link to="/docs/start" style={{ textDecoration: 'none' }}>
                <Mono fontSize={16} color="primary" fontWeight={500}>
                  Get started →
                </Mono>
              </Link>
              <Link to="/docs" style={{ textDecoration: 'none' }}>
                <Mono fontSize={14} color="text-muted">
                  Why Animus?
                </Mono>
              </Link>
            </Stack>
          </Reveal>
        </Stack>
      </Scene>
    </>
  );
}
