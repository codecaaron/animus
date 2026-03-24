import { useEffect, useState } from 'react';

import {
  Accent,
  Callout,
  Display,
  EmberDivider,
  HorizontalMark,
  Label,
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
  Strong,
  SyntaxBlock,
  VerticalBleed,
} from './components';

// ─── Intersection Observer Hook ─────────────────────────────

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

const DEFINE_EXAMPLE = `import { ds } from './ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    p: 24,
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    transition: 'border-color 0.2s ease',
    '&:hover': {
      borderColor: 'primary',
    },
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
    disabled: {
      opacity: '0.4',
      pointerEvents: 'none',
    },
  })
  .groups({ space: true, arrange: true })
  .asElement('div');`;

const USE_EXAMPLE = `<Card elevation="floating" p={32} gap={16}>
  <Heading>Static extraction</Heading>
  <Text>Zero runtime. Full expression.</Text>
</Card>

<Card elevation="raised" disabled>
  <Text color="textMuted">
    This variant exists in CSS.
    It was never computed.
  </Text>
</Card>`;

const OUTPUT_CSS = `/* Zero JavaScript. */

@layer base {
  .card-a7x2 {
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    background-color: var(--color-surface);
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

const CONFIG_EXAMPLE = `// ds.ts — one file. the whole language.
import { createSystem, createTransform } from '@animus-ui/system';
import { color, space, flex, typography } from '@animus-ui/system/groups';
import { createTheme } from '@animus-ui/theming';

// Your transforms. Not ours.
const fluid = createTransform('fluid', (value) => {
  const [min, max] = String(value).split('-').map(Number);
  return \`clamp(\${min / 16}rem, ... , \${max / 16}rem)\`;
});

// Your vocabulary. Your scales.
const tokens = createTheme({ breakpoints: { sm: 768, md: 1024 } })
  .addScale('space', () => ({
    4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem',
  }))
  .addColors({
    ember: '#FF2800',
    void: '#000000',
    bone: '#E8E0D0',
  })
  .addColorModes('dark', {
    dark:  { primary: 'ember', bg: 'void', text: 'bone' },
    light: { primary: 'ember', bg: 'bone', text: 'void' },
  })
  .build();

// Three groups. That's the whole system.
export const ds = createSystem()
  .withTokens(() => tokens)
  .withProperties((p) => p
    .addGroup('surface', { ...color, ...border })
    .addGroup('text', {
      ...typography,
      fluidSize: { property: 'fontSize', transform: fluid },
    })
    .addGroup('space', space)
    .build()
  )
  .build();`;

// ─── App ────────────────────────────────────────────────────

export default function App() {
  return (
    <>
      <ReadingBar />

      {/* ═══════ I. COLD OPEN ═══════ */}
      <Scene py={0} minHeight="100vh">
        <Stack alignItems="center" gap={32}>
          <Reveal>
            <Display
              fontSize={{ _: 72, md: 96 }}
              letterSpacing="-0.04em"
              textAlign="center"
              animation="ember 3s ease-in-out infinite"
            >
              Animus
            </Display>
          </Reveal>
          <Reveal delay="1">
            <Label
              color="accent"
              letterSpacing="0.3em"
              fontSize={11}
              fontWeight={500}
            >
              Finite Style Machine
            </Label>
          </Reveal>
          <Reveal delay="2">
            <VerticalBleed
              height="80px"
              mt={32}
              background="linear-gradient(180deg, #FF2800, transparent)"
            />
          </Reveal>
        </Stack>
      </Scene>

      {/* ═══════ II. THE INDICTMENT ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="42rem" mx="auto">
            <Reveal>
              <SectionLabel>The indictment</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 24, md: 40 }} lineHeight="snug">
                For six years, the frontend ecosystem has been telling you that{' '}
                <Accent>expressiveness is expensive.</Accent>
              </Display>
            </Reveal>
            <Reveal delay="2">
              <Prose fontSize={{ _: 16, md: 18 }} lineHeight="relaxed">
                That colocated styles are a performance liability. That the
                cascade is your enemy. That the only responsible choice is to
                flatten your design language into utility classes and pretend
                that
              </Prose>
            </Reveal>
            <Reveal delay="3">
              <Callout>
                className=&quot;flex p-4 gap-2 bg-white rounded-lg
                shadow-md&quot;
              </Callout>
            </Reveal>
            <Reveal delay="4">
              <Prose fontSize={{ _: 16, md: 18 }} lineHeight="relaxed">
                is an acceptable way to think about design.
              </Prose>
            </Reveal>
            <Reveal>
              <Prose
                fontSize={{ _: 18, md: 24 }}
                lineHeight="snug"
                color="text"
                fontWeight={300}
              >
                They told you the abstraction was the problem.
              </Prose>
            </Reveal>
            <Reveal delay="1">
              <Display
                fontSize={{ _: 40, md: 56 }}
                color="primary"
                lineHeight="tight"
                animation="ember 3s ease-in-out infinite"
              >
                It was never the abstraction.
              </Display>
            </Reveal>
            <Reveal delay="2">
              <Prose fontSize={{ _: 16, md: 18 }} lineHeight="relaxed">
                It was the runtime. And now{' '}
                <Strong>the runtime is gone.</Strong>
              </Prose>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      <EmberDivider />

      {/* ═══════ III. THE CHAIN ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>The declaration</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                The builder chain <Accent>is</Accent> the cascade.
              </Display>
            </Reveal>
            <Reveal delay="2">
              <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
                Each method maps to a CSS{' '}
                <Mono fontSize={14} color="primary">
                  @layer
                </Mono>
                . The ordering isn&apos;t convention &mdash; it&apos;s
                architecture. The type system enforces it.
              </Prose>
            </Reveal>

            <Reveal delay="3">
              <Stack gap={0}>
                {[
                  {
                    method: '.styles()',
                    layer: '@layer base',
                    desc: 'Foundation. Invariant identity.',
                  },
                  {
                    method: '.variant()',
                    layer: '@layer variants',
                    desc: 'Named variations. Enumerated. Finite.',
                  },
                  {
                    method: '.states()',
                    layer: '@layer states',
                    desc: 'Boolean conditions.',
                  },
                  {
                    method: '.groups()',
                    layer: '@layer system',
                    desc: 'System props. CSS variable slots.',
                  },
                  {
                    method: '.asElement()',
                    layer: 'sealed',
                    desc: 'Terminal. Configuration sealed.',
                  },
                ].map((s, i) => (
                  <StratumRow
                    key={s.method}
                    kind={i === 4 ? 'terminal' : undefined}
                    borderBottom={i < 4 ? 1 : undefined}
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

      <EmberDivider />

      {/* ═══════ IV. DEFINE ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>Define</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                Write it <Accent>once.</Accent>
              </Display>
            </Reveal>
            <Reveal delay="2">
              <SyntaxBlock language="tsx">{DEFINE_EXAMPLE}</SyntaxBlock>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      {/* ═══════ V. USE ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>Use</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                Use it like a <Accent>component.</Accent>
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
                Variants are props. States are props. System props are props.
              </Prose>
            </Reveal>
            <Reveal delay="2">
              <SyntaxBlock language="tsx">{USE_EXAMPLE}</SyntaxBlock>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      {/* ═══════ VI. SHIP ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>Ship</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                What <Accent>remains</Accent> is CSS.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
                The Rust extraction pipeline walks the chain. Enumerates every
                possible style. Reconciles against usage. Emits static CSS. The
                JavaScript disappears.
              </Prose>
            </Reveal>
            <Reveal delay="2">
              <SyntaxBlock language="css">{OUTPUT_CSS}</SyntaxBlock>
            </Reveal>
            <Reveal delay="3">
              <Row gap={64} justifyContent="center" mt={48}>
                <Stack alignItems="center" gap={8}>
                  <Display
                    fontSize={{ _: 56, md: 96 }}
                    color="primary"
                    lineHeight="none"
                    animation="ember 3s ease-in-out infinite, tally-pulse 2s ease-in-out infinite"
                  >
                    0
                  </Display>
                  <Label color="smoke" fontSize={11}>
                    runtime
                  </Label>
                </Stack>
                <Stack alignItems="center" gap={8}>
                  <Display
                    fontSize={{ _: 56, md: 96 }}
                    color="primary"
                    lineHeight="none"
                    animation="ember 3s ease-in-out infinite, tally-pulse 2s ease-in-out infinite"
                  >
                    0
                  </Display>
                  <Label color="smoke" fontSize={11}>
                    style recalc
                  </Label>
                </Stack>
              </Row>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      <EmberDivider />

      {/* ═══════ VII. YOUR LANGUAGE ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>Your vocabulary</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                Declare your <Accent>own</Accent> language.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
                One file. Your scales. Your colors. Your transforms. Not ours.
                Not Tailwind&apos;s. <Strong>Yours.</Strong>
              </Prose>
            </Reveal>
            <Reveal delay="2">
              <SyntaxBlock language="tsx">{CONFIG_EXAMPLE}</SyntaxBlock>
            </Reveal>
            <Reveal delay="3">
              <Prose fontSize={14} fontStyle="italic" color="smoke" mt={16}>
                No framework defaults to fight. No training-data ghosts
                whispering someone else&apos;s vocabulary.
              </Prose>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      <EmberDivider />

      {/* ═══════ VIII. THE CONSTRAINT ═══════ */}
      <Scene py={96} minHeight="auto">
        <Slab px={{ _: 24, md: 48 }}>
          <Stack gap={48} maxWidth="48rem" mx="auto">
            <Reveal>
              <SectionLabel>The constraint</SectionLabel>
            </Reveal>
            <Reveal delay="1">
              <Display fontSize={{ _: 32, md: 56 }} lineHeight="tight">
                No wrong answers.
                <br />
                Only <Accent>declared</Accent> values.
              </Display>
            </Reveal>
            <Reveal delay="1">
              <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
                Want a color that doesn&apos;t exist? Add it to the scale. Want
                a computed value? Define a transform. Want a new prop? Expose it
                through a group.
              </Prose>
            </Reveal>
            <Reveal delay="2">
              <Stack gap={0}>
                {[
                  {
                    level: '0',
                    name: 'None',
                    who: 'Emotion',
                    example: 'color: whateverYouWant',
                    active: false,
                  },
                  {
                    level: '1',
                    name: 'Naming',
                    who: 'Tailwind',
                    example: 'bg-[#ff00ff]',
                    active: false,
                  },
                  {
                    level: '2',
                    name: 'Vocabulary',
                    who: 'Panda CSS',
                    example: "css({ color: 'primary' })",
                    active: false,
                  },
                  {
                    level: '3',
                    name: 'Composition',
                    who: 'Animus chain',
                    example: '.styles() → .variant() → .states()',
                    active: false,
                  },
                  {
                    level: '4',
                    name: 'Universe',
                    who: 'Animus sealed',
                    example: '.asElement() seals the space',
                    active: true,
                  },
                ].map((c) => (
                  <StratumRow
                    key={c.level}
                    kind={c.active ? 'terminal' : undefined}
                    borderBottom={c.level !== '4' ? 1 : undefined}
                    px={24}
                  >
                    <Row justifyContent="space-between" alignItems="baseline">
                      <Row gap={12} alignItems="baseline">
                        <Mono
                          fontSize={14}
                          color={c.active ? 'accent' : 'smoke'}
                          fontWeight={500}
                        >
                          {c.level}
                        </Mono>
                        <Mono
                          fontSize={16}
                          color={c.active ? 'text' : 'textMuted'}
                          fontWeight={500}
                        >
                          {c.name}
                        </Mono>
                      </Row>
                      <Label
                        color={c.active ? 'accent' : 'textDim'}
                        pl={8}
                        fontSize={11}
                      >
                        {c.who}
                      </Label>
                    </Row>
                    <Mono
                      fontSize={12}
                      color={c.active ? 'accent' : 'textDim'}
                      mt={4}
                    >
                      {c.example}
                    </Mono>
                  </StratumRow>
                ))}
              </Stack>
            </Reveal>
          </Stack>
        </Slab>
      </Scene>

      <EmberDivider />

      {/* ═══════ IX. CODA ═══════ */}
      <Scene py={128} minHeight="80vh">
        <Stack alignItems="center" gap={48} maxWidth="42rem" px={24}>
          <Reveal>
            <Display
              fontSize={{ _: 24, md: 40 }}
              lineHeight="snug"
              textAlign="center"
            >
              The expressiveness was never the problem.
            </Display>
          </Reveal>
          <Reveal delay="1">
            <Display
              fontSize={{ _: 24, md: 40 }}
              lineHeight="snug"
              textAlign="center"
            >
              The abstraction was never the cost.
            </Display>
          </Reveal>
          <Reveal delay="2">
            <Display
              fontSize={{ _: 40, md: 72 }}
              lineHeight="tight"
              textAlign="center"
              color="primary"
              animation="ember 3s ease-in-out infinite"
            >
              The runtime is{' '}
              <Mono
                fontFamily="display"
                fontStyle="italic"
                color="accent"
                fontSize={{ _: 40, md: 72 }}
              >
                zero.
              </Mono>
            </Display>
          </Reveal>
          <Reveal delay="3">
            <HorizontalMark width="60px" mx="auto" />
          </Reveal>
          <Reveal delay="4">
            <Label
              color="accent"
              letterSpacing="0.25em"
              fontSize={11}
              fontWeight={500}
            >
              Static extraction &middot; Zero runtime &middot; Full expression
            </Label>
          </Reveal>
        </Stack>
      </Scene>
    </>
  );
}
