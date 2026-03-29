import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  CascadeLayer,
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
  .system({ space: true, arrange: true })
  .asElement('div');`;

const CSS_OUTPUT = `/* What the extraction produces. */

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
        <Stack alignItems="center" gap={48}>
          <Reveal>
            <Logo logoSize={logoSize}>Animus</Logo>
          </Reveal>
          <Reveal delay="1">
            <HorizontalMark width="40px" />
          </Reveal>
          <Reveal delay="2">
            <Label
              color="text-dim"
              letterSpacing="0.4em"
              fontSize={11}
              fontWeight={400}
            >
              Not a runtime.
            </Label>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ II. THE LOSS ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto" bg="bg-muted">
        <Stack gap={48} maxWidth="38rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={24}>
            <Reveal>
              <Prose
                fontSize={{ _: 16, md: 18 }}
                lineHeight="relaxed"
                color="text"
              >
                CSS-in-JS solved real problems. Colocated styles. Typed tokens.
                Variant systems. Component-scoped reasoning. For a while, it was
                the right answer.
              </Prose>
            </Reveal>
            <Reveal delay="1">
              <Prose
                fontSize={{ _: 16, md: 18 }}
                lineHeight="relaxed"
                color="text-muted"
              >
                Then the runtime that made it work became the thing that killed
                it.
              </Prose>
            </Reveal>
            <Reveal delay="2">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                color="text-dim"
              >
                Every alternative since has asked you to trade something away.
              </Prose>
            </Reveal>
          </Stack>
        </Stack>
      </Scene>

      {/* ═══════ III. THE THESIS ═══════ */}
      <Scene py={{ _: 96, md: 160 }} minHeight="auto">
        <Stack gap={96} maxWidth="44rem" mx="auto" px={{ _: 24, md: 48 }}>
          <Stack gap={48}>
            <Stack gap={12}>
              <Reveal>
                <Display fontSize={{ _: 24, md: 48 }} lineHeight="tight">
                  The authoring model you lost.
                </Display>
              </Reveal>
              <Reveal delay="1">
                <Display
                  fontSize={{ _: 24, md: 48 }}
                  lineHeight="tight"
                  color="text-muted"
                >
                  The runtime you didn't.
                </Display>
              </Reveal>
            </Stack>
            <Reveal delay="2">
              <Prose
                fontSize={{ _: 14, md: 16 }}
                lineHeight="relaxed"
                maxWidth="36rem"
              >
                The builder chain declares every possible output — variants,
                states, compounds, responsive overrides — as a finite tree. A
                Rust compiler walks every branch, resolves every token, and
                emits static CSS. What remains at runtime is class selection —
                not style computation.
              </Prose>
            </Reveal>
          </Stack>

          <Reveal>
            <CodeExample input={COMPONENT_SOURCE} output={CSS_OUTPUT} />
          </Reveal>
        </Stack>
      </Scene>

      <FireLine />

      {/* ═══════ IV. THE CONTRACT ═══════ */}
      <Scene py={{ _: 96, md: 128 }} minHeight="auto" bg="bg-muted">
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
                color="text-muted"
              >
                Each builder method maps to a layer. Layer position determines
                precedence — not selectors, not source order.
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
                  <Mono fontSize={12} color="text-dim">
                    {desc}
                  </Mono>
                </CascadeLayer>
              ))}
            </Stack>
          </Reveal>

          <Reveal delay="3">
            <Prose fontSize={14} lineHeight="relaxed" color="text-dim">
              A state always beats a variant. A system prop always beats a base
              style. The ordering is explicit and static.
            </Prose>
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ V. CTA ═══════ */}
      <Scene py={{ _: 128, md: 160 }} minHeight="auto">
        <Stack gap={48} maxWidth="44rem" mx="auto" alignItems="center" px={24}>
          <Stack gap={16} alignItems="center">
            <Reveal>
              <Mono
                fontSize={{ _: 32, md: 48 }}
                fontWeight={700}
                fontFamily={'logo'}
              >
                css-in-js
              </Mono>
              {'  '}
              <Mono
                fontSize={{ _: 24, md: 32 }}
                fontFamily={'logo'}
                color="text-muted"
              >
                is dead
              </Mono>
            </Reveal>
            <Reveal delay="1">
              <Mono
                fontSize={{ _: 24, md: 32 }}
                fontFamily={'logo'}
                color="text-muted"
              >
                the authoring model
              </Mono>
              {'  '}
              <GlowText variant={logo} test={cool} fontSize={{ _: 32, md: 48 }}>
                isn't
              </GlowText>
            </Reveal>
          </Stack>
          <Reveal delay="2">
            <HorizontalMark width="40px" />
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
