import { useState } from 'react';

import {
  AnchorHeading,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Code,
  CodeBlock,
  ColorSwatch,
  Container,
  Divider,
  FeatureCard,
  FluidHeading,
  FocusBox,
  GradientBar,
  Heading,
  HeroSubtitle,
  Label,
  Logo,
  MediaFrame,
  ModeToggle,
  Nav,
  Row,
  Section,
  SmallButton,
  SpecimenRow,
  SpecimenSize,
  Stack,
  Text,
  Timeline,
  TimelineContent,
  TimelineLine,
  TimelineMarker,
  TimelineStep,
  TimelineTrack,
} from './components';
import { Arrange, Chip, GridArrange, Panel, Prose } from './ds';

// ─── App ──────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return (
        document.documentElement.getAttribute('data-color-mode') || 'light'
      );
    }
    return 'light';
  });

  const toggleMode = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    document.documentElement.setAttribute('data-color-mode', next);
    localStorage.setItem('color-mode', next);
  };

  return (
    <AppShell>
      {/* ─── Header ─── */}
      <Container>
        <Nav>
          <Logo>animus</Logo>
          <Row gap={12}>
            <Badge variant="primary">v0.3</Badge>
            <ModeToggle onClick={toggleMode}>
              {mode === 'light' ? '◑' : '◐'}
            </ModeToggle>
          </Row>
        </Nav>
      </Container>

      {/* ─── Hero ─── */}
      <Section>
        <Container>
          <Stack gap={24}>
            <GradientBar width="6rem" />
            <Heading as="h1">
              The Finite{'\u2009'}Style{'\u2009'}Machine
            </Heading>
            <HeroSubtitle>
              A type-state builder chain that compiles to static CSS. Every
              style is extractable. Every override is predictable. Zero runtime
              in production.
            </HeroSubtitle>
            <Row gap={12}>
              <Button variant="primary">Get Started</Button>
              <Button variant="ghost">Documentation</Button>
            </Row>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Features ─── */}
      <Section id="features">
        <Container>
          <Stack gap={48}>
            <Stack gap={12}>
              <Label>Capabilities</Label>
              <AnchorHeading as="h2" href="#features">
                Built for design systems
              </AnchorHeading>
            </Stack>

            <Box display="grid" gap={24} cols={{ _: 1, sm: 2, md: 3 }}>
              <FeatureCard>
                <Badge variant="primary">extraction</Badge>
                <Heading as="h4" color="text">
                  Static CSS Output
                </Heading>
                <Text color="textMuted">
                  Builder chains compile to <Code>@layer</Code>-structured CSS
                  at build time. No runtime style injection. No Emotion. No
                  overhead.
                </Text>
              </FeatureCard>

              <FeatureCard>
                <Badge variant="accent">cascade</Badge>
                <Heading as="h4" color="text">
                  Predictable Layers
                </Heading>
                <Text color="textMuted">
                  Five CSS layers — <Code>base</Code>, <Code>variants</Code>,{' '}
                  <Code>states</Code>, <Code>system</Code>, <Code>custom</Code>{' '}
                  — enforce cascade priority.
                </Text>
              </FeatureCard>

              <FeatureCard>
                <Badge>type-safe</Badge>
                <Heading as="h4" color="text">
                  Compile-Time Checks
                </Heading>
                <Text color="textMuted">
                  The type-state machine prevents invalid method sequences.
                  TypeScript catches <Code>variant=&quot;typo&quot;</Code>{' '}
                  before you ship.
                </Text>
              </FeatureCard>
            </Box>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Buttons ─── */}
      <Section id="buttons">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Components</Label>
              <AnchorHeading as="h2" href="#buttons">
                Buttons
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                Variants define visual intent. States modify interactivity.
                System props handle spacing at the callsite.
              </Text>
            </Stack>

            <Card p={32}>
              <Label mb={16}>Variants</Label>
              <Row gap={12} flexWrap="wrap">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="small">Small</Button>
              </Row>
            </Card>

            <Card p={32}>
              <Label mb={16}>States</Label>
              <Row gap={12} flexWrap="wrap">
                <Button variant="primary">Enabled</Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="ghost">Enabled</Button>
                <Button variant="ghost" disabled>
                  Disabled
                </Button>
              </Row>
            </Card>

            <Card p={32}>
              <Label mb={16}>Extension Chain</Label>
              <Text color="textMuted" mb={16}>
                <Code>SmallButton</Code> extends <Code>Button</Code> with
                reduced padding, smaller font, tighter radius.
              </Text>
              <Row gap={8} flexWrap="wrap">
                <SmallButton>Tag</SmallButton>
                <SmallButton>Filter</SmallButton>
                <SmallButton>Action</SmallButton>
              </Row>
            </Card>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Badges ─── */}
      <Section id="badges">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Tokens</Label>
              <AnchorHeading as="h2" href="#badges">
                Badges &amp; Semantic Colors
              </AnchorHeading>
            </Stack>

            <Card p={32}>
              <Row gap={8} flexWrap="wrap">
                <Badge>Default</Badge>
                <Badge variant="primary">Primary</Badge>
                <Badge variant="accent">Accent</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
              </Row>
            </Card>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Typography ─── */}
      <Section id="typography">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Typography</Label>
              <AnchorHeading as="h2" href="#typography">
                Type Scale
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                DM Serif Display for headings. DM Sans for body. JetBrains Mono
                for code.
              </Text>
            </Stack>

            <Card p={32} gap={0}>
              <SpecimenRow>
                <SpecimenSize>64px</SpecimenSize>
                <Heading as="h1">Display</Heading>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>48px</SpecimenSize>
                <Heading as="h2">Headline</Heading>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>30px</SpecimenSize>
                <Heading as="h3">Title</Heading>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>20px</SpecimenSize>
                <Text size="xl">Large body copy for emphasis.</Text>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>16px</SpecimenSize>
                <Text>Default body text for readable content.</Text>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>14px</SpecimenSize>
                <Text size="sm" color="textMuted">
                  Small text for captions and metadata.
                </Text>
              </SpecimenRow>
              <SpecimenRow>
                <SpecimenSize>mono</SpecimenSize>
                <Code>const finite = true;</Code>
              </SpecimenRow>
            </Card>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Color Palette ─── */}
      <Section id="colors">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Palette</Label>
              <AnchorHeading as="h2" href="#colors">
                Color Tokens
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                Semantic tokens resolve to CSS custom properties. Toggle the
                mode to see the dark palette.
              </Text>
            </Stack>

            <Box display="grid" gap={24} cols={{ _: 1, md: 2 }}>
              <Card p={24} gap={16}>
                <Label>Semantic</Label>
                <Row gap={8} flexWrap="wrap">
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="primary" />
                    <Text size="sm" color="textMuted">
                      primary
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="secondary" />
                    <Text size="sm" color="textMuted">
                      secondary
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="accent" />
                    <Text size="sm" color="textMuted">
                      accent
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="success" />
                    <Text size="sm" color="textMuted">
                      success
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="warning" />
                    <Text size="sm" color="textMuted">
                      warning
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="error" />
                    <Text size="sm" color="textMuted">
                      error
                    </Text>
                  </Stack>
                </Row>
              </Card>

              <Card p={24} gap={16}>
                <Label>Surfaces</Label>
                <Row gap={8} flexWrap="wrap">
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="background" />
                    <Text size="sm" color="textMuted">
                      bg
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="backgroundMuted" />
                    <Text size="sm" color="textMuted">
                      muted
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="surface" />
                    <Text size="sm" color="textMuted">
                      surface
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="text" />
                    <Text size="sm" color="textMuted">
                      text
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="textMuted" />
                    <Text size="sm" color="textMuted">
                      muted
                    </Text>
                  </Stack>
                  <Stack gap={4} alignItems="center">
                    <ColorSwatch bg="border" borderColor="borderStrong" />
                    <Text size="sm" color="textMuted">
                      border
                    </Text>
                  </Stack>
                </Row>
              </Card>
            </Box>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Transforms ─── */}
      <Section id="transforms">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Transforms</Label>
              <AnchorHeading as="h2" href="#transforms">
                Computed at build time
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                Custom transforms parse syntax and compute CSS values. The
                extraction pipeline runs them once — the output is static.
              </Text>
            </Stack>

            <Stack gap={24}>
              <Card p={32} gap={16}>
                <Row gap={12} alignItems="baseline">
                  <Badge variant="primary">fluid</Badge>
                  <Label>Viewport-responsive typography</Label>
                </Row>
                <Stack gap={8}>
                  <FluidHeading fluidSize="24-48">
                    This heading scales fluidly
                  </FluidHeading>
                  <Text color="textMuted">
                    <Code>fluidSize=&quot;24-48&quot;</Code> compiles to{' '}
                    <Code>font-size: clamp(1.5rem, ... + ...vw, 3rem)</Code>.
                    Resize your browser to see it.
                  </Text>
                </Stack>
              </Card>

              <Box display="grid" gap={24} cols={{ _: 1, md: 2 }}>
                <Card p={32} gap={16}>
                  <Row gap={12} alignItems="baseline">
                    <Badge variant="accent">ratio</Badge>
                    <Label>Aspect ratio from colon syntax</Label>
                  </Row>
                  <Box display="grid" gap={12} cols={4}>
                    <MediaFrame ratio="1:1">1:1</MediaFrame>
                    <MediaFrame ratio="16:9">16:9</MediaFrame>
                    <MediaFrame ratio="4:3">4:3</MediaFrame>
                    <MediaFrame ratio="21:9">21:9</MediaFrame>
                  </Box>
                  <Text size="sm" color="textMuted">
                    <Code>ratio=&quot;16:9&quot;</Code> → transform parses colon
                    syntax → <Code>aspect-ratio: 16 / 9</Code>
                  </Text>
                </Card>

                <Card p={32} gap={16}>
                  <Row gap={12} alignItems="baseline">
                    <Badge>ring</Badge>
                    <Label>Focus indicator via box-shadow</Label>
                  </Row>
                  <Row gap={12} flexWrap="wrap">
                    <FocusBox ring={2} color="primary">
                      ring=&#123;2&#125;
                    </FocusBox>
                    <FocusBox ring={3} color="accent">
                      ring=&#123;3&#125;
                    </FocusBox>
                    <FocusBox ring={4} color="success">
                      ring=&#123;4&#125;
                    </FocusBox>
                  </Row>
                  <Text size="sm" color="textMuted">
                    <Code>ring=&#123;2&#125;</Code> → transform computes →{' '}
                    <Code>box-shadow: 0 0 0 2px currentColor</Code>. No layout
                    shift.
                  </Text>
                </Card>
              </Box>

              <Card p={32} gap={16}>
                <Row gap={12} alignItems="baseline">
                  <Badge variant="primary">scale vs transform</Badge>
                  <Label>Theme lookup vs computation</Label>
                </Row>
                <Box display="grid" gap={24} cols={{ _: 1, md: 2 }}>
                  <Stack gap={8}>
                    <Label>Theme Scale (enumerated)</Label>
                    <Code>
                      elevation=&#123;3&#125; → theme.elevation[3] → static
                      shadow
                    </Code>
                    <Text size="sm" color="textMuted">
                      Finite set of values. Resolved by the Rust pipeline
                      against the serialized theme. No JS runs.
                    </Text>
                  </Stack>
                  <Stack gap={8}>
                    <Label>Transform (computed)</Label>
                    <Code>
                      fluid=&quot;16-24&quot; → parse → clamp(1rem, ...vw,
                      1.5rem)
                    </Code>
                    <Text size="sm" color="textMuted">
                      Unbounded input. Resolved by JS post-processing at build
                      time. The transform function runs once, output is static
                      CSS.
                    </Text>
                  </Stack>
                </Box>
              </Card>
            </Stack>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── Custom Vocabulary ─── */}
      <Section id="vocabulary">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Your Language</Label>
              <AnchorHeading as="h2" href="#vocabulary">
                Design your own vocabulary
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                The default prop groups are a starting point.{' '}
                <Code>createAnimus()</Code> lets you design your own language —
                custom prop names, custom scales, custom transforms.
              </Text>
            </Stack>

            <Box display="grid" gap={24} cols={{ _: 1, md: 2 }}>
              <Card p={32} gap={16}>
                <Label>Default vocabulary</Label>
                <Code>
                  {'<Card bg="surface" borderRadius={12} boxShadow={...} />'}
                </Code>
                <Text size="sm" color="textMuted">
                  CSS property names. Explicit. Verbose.
                </Text>
              </Card>
              <Card p={32} gap={16}>
                <Label>Custom vocabulary</Label>
                <Code>{'<Panel elevation={2} radius={12} />'}</Code>
                <Text size="sm" color="textMuted">
                  Semantic names. Your team&apos;s language. Same extraction.
                </Text>
              </Card>
            </Box>

            <Stack gap={16}>
              <Label>Custom components in action</Label>

              <Panel>
                <Arrange flexDirection="column" gap={12}>
                  <Prose fontWeight={600}>This Panel has hover elevation</Prose>
                  <Prose color="textMuted">
                    Built with a custom <Code>surface</Code> group that merges{' '}
                    <Code>color</Code>, <Code>border</Code>,{' '}
                    <Code>shadows</Code>, and <Code>background</Code> into one
                    group. Hover to see the shadow transition.
                  </Prose>
                  <Arrange gap={8} flexWrap="wrap">
                    <Chip>surface</Chip>
                    <Chip>arrange</Chip>
                    <Chip>motion</Chip>
                    <Chip>text</Chip>
                    <Chip>space</Chip>
                  </Arrange>
                </Arrange>
              </Panel>

              <GridArrange cols={3} gap={16}>
                <Panel>
                  <Prose fontWeight={600} fontSize={14}>
                    Panel A
                  </Prose>
                  <Prose color="textMuted" fontSize={12}>
                    Same props, fewer groups
                  </Prose>
                </Panel>
                <Panel>
                  <Prose fontWeight={600} fontSize={14}>
                    Panel B
                  </Prose>
                  <Prose color="textMuted" fontSize={12}>
                    Two groups cover everything
                  </Prose>
                </Panel>
                <Panel>
                  <Prose fontWeight={600} fontSize={14}>
                    Panel C
                  </Prose>
                  <Prose color="textMuted" fontSize={12}>
                    Your team&apos;s vocabulary
                  </Prose>
                </Panel>
              </GridArrange>
            </Stack>
          </Stack>
        </Container>
      </Section>

      <Container>
        <Divider />
      </Container>

      {/* ─── What Ships ─── */}
      <Section id="output">
        <Container>
          <Stack gap={32}>
            <Stack gap={12}>
              <Label>Output</Label>
              <AnchorHeading as="h2" href="#output">
                What actually ships
              </AnchorHeading>
              <Text color="textMuted" size="lg">
                The builder chain order IS the CSS cascade order. This
                isn&apos;t an implementation detail — it&apos;s a structural
                guarantee.
              </Text>
            </Stack>

            <Card p={32} gap={16}>
              <Label>
                The layer declaration — one line, defines everything
              </Label>
              <CodeBlock>
                {'@layer base, variants, states, system, custom;'}
              </CodeBlock>
              <Text size="sm" color="textMuted">
                <Code>.styles()</Code> → base. <Code>.variant()</Code> →
                variants. <Code>.states()</Code> → states.{' '}
                <Code>.groups()</Code> → system. The API order IS the cascade
                order.
              </Text>
            </Card>

            {/* ─── Pipeline Timeline ─── */}
            <Timeline>
              <TimelineStep>
                <TimelineTrack>
                  <TimelineMarker bg="primary" color="background">
                    1
                  </TimelineMarker>
                  <TimelineLine />
                </TimelineTrack>
                <TimelineContent>
                  <Stack gap={16}>
                    <Stack gap={4}>
                      <Heading as="h4">Define</Heading>
                      <Text size="sm" color="textMuted">
                        The builder chain defines every possible CSS rule. The
                        style universe is sealed at <Code>.asElement()</Code>.
                      </Text>
                    </Stack>
                    <CodeBlock language="tsx">
                      {`const Button = ds
  .styles({
    borderRadius: 8,
    cursor: 'pointer',
  })
  .variant({
    variants: {
      primary: { bg: 'primary' },
      secondary: { bg: 'accent' },
      ghost: { bg: 'transparent' },
      small: { fontSize: 14 },
    },
  })
  .states({
    disabled: { opacity: 0.4 },
  })
  .groups({ space: true })
  .asElement('button')`}
                    </CodeBlock>
                    <Text size="sm" color="textMuted">
                      4 variants, 1 state, system props. Finite and enumerable.
                    </Text>
                  </Stack>
                </TimelineContent>
              </TimelineStep>

              <TimelineStep>
                <TimelineTrack>
                  <TimelineMarker bg="accent" color="background">
                    2
                  </TimelineMarker>
                  <TimelineLine />
                </TimelineTrack>
                <TimelineContent>
                  <Stack gap={16}>
                    <Stack gap={4}>
                      <Heading as="h4">Use</Heading>
                      <Text size="sm" color="textMuted">
                        The Rust pipeline scans every JSX callsite. Each usage
                        is a transaction against the style ledger.
                      </Text>
                    </Stack>
                    <CodeBlock language="tsx">
                      {`<Button variant="primary">Get Started</Button>
<Button variant="ghost">Documentation</Button>
<Button variant="ghost" disabled>Coming Soon</Button>

// "secondary" and "small" are never referenced.`}
                    </CodeBlock>
                    <Text size="sm" color="textMuted">
                      Only <Code>primary</Code> and <Code>ghost</Code> are used.
                      The rest are marked for elimination.
                    </Text>
                  </Stack>
                </TimelineContent>
              </TimelineStep>

              <TimelineStep>
                <TimelineTrack>
                  <TimelineMarker bg="success" color="background">
                    3
                  </TimelineMarker>
                </TimelineTrack>
                <TimelineContent pb={0}>
                  <Stack gap={16}>
                    <Stack gap={4}>
                      <Heading as="h4">Ship</Heading>
                      <Text size="sm" color="textMuted">
                        Only used styles reach the browser. Dead variants are
                        provably eliminated.
                      </Text>
                    </Stack>
                    <CodeBlock language="css">
                      {`@layer base {
  .animus-Button {
    border-radius: 8px;
    cursor: pointer;
  }
}

@layer variants {
  /* 2 of 4 variants survive reconciliation */
  .animus-Button--primary {
    background-color: var(--color-primary);
  }
  .animus-Button--ghost {
    background-color: transparent;
  }
  /* secondary — eliminated (zero usages) */
  /* small — eliminated (zero usages) */
}

@layer states {
  .animus-Button--disabled {
    opacity: 0.4;
  }
}`}
                    </CodeBlock>
                  </Stack>
                </TimelineContent>
              </TimelineStep>
            </Timeline>

            {/* ─── Responsive + Transforms ─── */}
            <Card p={32} gap={16}>
              <Row gap={12} alignItems="baseline">
                <Badge>responsive</Badge>
                <Label>Responsive values compile to @media inside @layer</Label>
              </Row>
              <CodeBlock language="tsx">
                {`// Responsive object syntax in a variant definition:
.variant({ prop: 'as', variants: {
  h1: { fontSize: { _: 48, md: 64 } }
}})`}
              </CodeBlock>
              <CodeBlock language="css">
                {`/* Compiles to media queries inside the correct layer: */
@layer variants {
  .animus-Heading--as-h1 { font-size: 3rem }
  @media (min-width: 1024px) {
    .animus-Heading--as-h1 { font-size: 4rem }
  }
}`}
              </CodeBlock>
              <Text size="sm" color="textMuted">
                Breakpoints resolve from your theme at build time. The cascade
                guarantees variants always override base, regardless of media
                query specificity.
              </Text>
            </Card>

            <Card p={32} gap={16}>
              <Row gap={12} alignItems="baseline">
                <Badge variant="accent">transforms</Badge>
                <Label>Custom transforms compile away</Label>
              </Row>
              <CodeBlock language="tsx">
                {`<FluidHeading fluidSize="24-48">Scales with viewport</FluidHeading>
<MediaFrame ratio="16:9" />
<FocusBox ring={2} color="primary">Focused</FocusBox>`}
              </CodeBlock>
              <CodeBlock language="css">
                {`/* Each transform runs once at build time: */
@layer system {
  .animus-u-bbe6400e {
    font-size: clamp(1.500rem, 0.750rem + 2.50vw, 3.000rem);
  }
  .animus-u-534bb03f { aspect-ratio: 16 / 9 }
  .animus-u-ef432972 { box-shadow: 0 0 0 2px currentColor }
}`}
              </CodeBlock>
              <Text size="sm" color="textMuted">
                Transform functions run once. The output is static CSS — no
                runtime, no computation, no hydration mismatch.
              </Text>
            </Card>
          </Stack>
        </Container>
      </Section>

      {/* ─── Footer ─── */}
      <Section bg="backgroundMuted" py={48}>
        <Container>
          <Row justifyContent="space-between" flexWrap="wrap" gap={16}>
            <Stack gap={4}>
              <Logo>animus</Logo>
              <Text size="sm" color="textMuted">
                Finite Style Machine
              </Text>
            </Stack>
            <Text size="sm" color="textMuted">
              Built with the extraction pipeline it demonstrates.
            </Text>
          </Row>
        </Container>
      </Section>
    </AppShell>
  );
}
