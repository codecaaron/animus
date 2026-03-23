import { useState } from 'react';

import {
  AppShell,
  Box,
  Button,
  CodeBlock,
  Container,
  EmberGlyph,
  ForgeBench,
  ForgeInput,
  ForgeLabel,
  ForgeOutput,
  ForgeScar,
  ForgeScarGlyph,
  ModeToggle,
  Nav,
  Section,
  Stack,
  Text,
  VerdictLine,
  VoidFrame,
  VoidSignature,
  VoidWhisper,
} from './components';
import {
  CodeAltar,
  Indictment,
  ProofSpecimenBlock,
  SectionScar,
} from './narrative';

// ─── App ──────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return (
        document.documentElement.getAttribute('data-color-mode') || 'dark'
      );
    }
    return 'dark';
  });

  const toggleMode = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    document.documentElement.setAttribute('data-color-mode', next);
    localStorage.setItem('color-mode', next);
  };

  return (
    <AppShell>
      {/* ═══ NAVIGATION ═══ */}
      <Container>
        <Nav>
          <ModeToggle onClick={toggleMode}>
            {mode === 'light' ? '◑' : '◐'}
          </ModeToggle>
        </Nav>
      </Container>

      {/* ═══ I. THE VOID ═══ */}
      <VoidFrame>
        <VoidSignature>animus</VoidSignature>
        <VoidWhisper>finite style machine</VoidWhisper>
      </VoidFrame>

      <Container>
        <SectionScar chapter="01" title="the indictment" />
      </Container>

      {/* ═══ II. THE INDICTMENT ═══ */}
      <Section>
        <Container>
          <Indictment
            baseDelay={0.3}
            stagger={0.4}
            lines={[
              {
                text: 'We had names for things.',
              },
              {
                text: '<NavigationBar /> meant something. <CardHeader /> meant something. The name was documentation. The name was a contract between the person who wrote it and the person who read it six months later at 11pm before a deadline.',
              },
              {
                text: 'Then we got fast.',
              },
              {
                text: 'className="flex items-center justify-between px-4 py-2 bg-gray-100 border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"',
                type: 'code',
              },
              {
                text: 'We called it productivity. We traded the contract for velocity. We told ourselves it was fine, actually. We wrote the blog posts.',
              },
              {
                text: 'I wrote the blog posts.',
                type: 'verdict',
              },
            ]}
          />

          <Box py={32} />

          <Indictment
            baseDelay={3.0}
            stagger={0.4}
            lines={[
              {
                text: 'The name was the first thing to go. Then went the reading. Then went the understanding. We kept the output. We threw away the intention.',
              },
              {
                text: 'Something had to remember what we forgot.',
                type: 'verdict',
              },
            ]}
          />
        </Container>
      </Section>

      <Container>
        <SectionScar chapter="02" title="what remains" />
      </Container>

      {/* ═══ III. WHAT REMAINS ═══ */}
      <Section>
        <Container>
          <CodeAltar
            file="components/Button.tsx"
            language="tsx"
            caption="Read it from top to bottom. That is a Button — with its base geometry, its intentions, its responses to being touched. The method order is not arbitrary. .styles() is base. .variant() is character. .states() are reactions. In that order, always, because the cascade is in that order."
          >
            {`const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'body',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  })
  .variant({
    variants: {
      primary: { bg: 'primary', color: 'background', px: 24, py: 12 },
      ghost:   { bg: 'transparent', color: 'primary', border: 1, borderColor: 'primary' },
    },
  })
  .states({
    disabled: { opacity: 0.3, cursor: 'not-allowed' },
  })
  .groups({ space: true })
  .asElement('button')`}
          </CodeAltar>

          <Text color="textMuted" fontSize={14} mt={32}>
            You already understand it. You didn't need me to explain it.
          </Text>
        </Container>
      </Section>

      <Container>
        <SectionScar chapter="03" title="the forge" />
      </Container>

      {/* ═══ IV. THE FORGE ═══ */}
      <Section>
        <Container>
          <Stack gap={48}>
            {/* Code Moment 2: The Revelation — chain → @layer CSS */}
            <ForgeBench>
              <ForgeInput>
                <ForgeLabel>what you write</ForgeLabel>
                <CodeBlock language="tsx">
                  {`const Button = ds
  .styles({ cursor: 'pointer', border: 'none' })
  .variant({
    variants: {
      primary: { bg: 'primary', color: 'background' },
      ghost:   { border: 1, borderColor: 'primary' },
    },
  })
  .states({ disabled: { opacity: 0.3 } })
  .groups({ space: true })
  .asElement('button')`}
                </CodeBlock>
              </ForgeInput>

              <ForgeScar>
                <ForgeScarGlyph>→</ForgeScarGlyph>
              </ForgeScar>

              <ForgeOutput>
                <ForgeLabel>what ships</ForgeLabel>
                <CodeBlock language="css">
                  {`@layer base {
  .animus-Button {
    cursor: pointer;
    border: none;
  }
}

@layer variants {
  .animus-Button--primary {
    background-color: var(--color-primary);
    color: var(--color-background);
  }
  .animus-Button--ghost {
    border: 1px solid var(--color-primary);
  }
}

@layer states {
  .animus-Button--disabled {
    opacity: 0.3;
  }
}`}
                </CodeBlock>
              </ForgeOutput>
            </ForgeBench>

            <Text color="textMuted" fontSize={14}>
              The method chain is the cascade. This is not a new idea. It is a
              recovered one.
            </Text>

            <EmberGlyph size="md">◆</EmberGlyph>

            {/* Code Moment 3: The Differentiator — fluid transform */}
            <CodeAltar
              file="ds.ts"
              language="tsx"
              caption="The function runs once. In Rust. At build time. A user-defined computation, expressed as a readable prop in JSX, compiled to static CSS. No other framework has this shape."
            >
              {`// 1. Define the transform — once, in your design system
const fluid = createTransform('fluid', (value) => {
  const [min, max] = String(value).split('-').map(Number);
  const slope = ((max - min) / 880) * 100;
  return \`clamp(\${min/16}rem, \${slope.toFixed(2)}vw, \${max/16}rem)\`;
});

// 2. Register it as a prop
.addGroup('text', {
  ...typography,
  fluidSize: { property: 'fontSize', transform: fluid },
})

// 3. Use it — the string is the intent, the math is invisible
<Heading fluidSize="24-48">The cascade belongs to you.</Heading>

// 4. What ships — computed once, at build time
// @layer system { .animus-u-3f8a { font-size: clamp(1.5rem, 2.73vw, 3rem) } }`}
            </CodeAltar>
          </Stack>
        </Container>
      </Section>

      <Container>
        <SectionScar chapter="04" title="the proof" />
      </Container>

      {/* ═══ V. THE PROOF ═══ */}
      <Section>
        <Container>
          <Stack gap={48}>
            <Text color="textMuted" fontSize={14}>
              Every component on this page was extracted at build time. No
              runtime. No injection. No compromise.
            </Text>

            <Box
              display="grid"
              gap={24}
              gridTemplateColumns={{ _: '1fr', md: '1fr 1fr' }}
            >
              <ProofSpecimenBlock
                title="Variant extraction"
                hash=".animus-Button--primary"
                layer="variants"
                css={`.animus-Button--primary {
  background-color: var(--color-primary);
  color: var(--color-background);
}`}
              >
                <Button variant="primary">Primary</Button>
                <Button variant="ghost">Ghost</Button>
              </ProofSpecimenBlock>

              <ProofSpecimenBlock
                title="State extraction"
                hash=".animus-Button--disabled"
                layer="states"
                css={`.animus-Button--disabled {
  opacity: 0.3;
  cursor: not-allowed;
}`}
              >
                <Button variant="primary">Enabled</Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
              </ProofSpecimenBlock>
            </Box>

            <Text color="textMuted" fontSize={14}>
              They work. Open devtools. Look at the layers. Every rule has a
              name. Every name means something.
            </Text>

            <Text color="textMuted" fontSize={14}>
              It was. Sort of.
            </Text>
          </Stack>
        </Container>
      </Section>

      <Container>
        <SectionScar chapter="05" title="color modes" />
      </Container>

      {/* ═══ Color Modes — Code Moment 4 ═══ */}
      <Section>
        <Container>
          <CodeAltar
            language="tsx"
            caption="One attribute. Zero re-renders. The browser has been excellent at custom properties since 2017. We just forgot."
          >
            {`// Define modes alongside your tokens
const tokens = createTheme({ ... })
  .addColorModes('dark', {
    dark:  { primary: 'ember',  background: 'carbon' },
    light: { primary: 'scorch', background: 'paper'  },
  })
  .build()

// What gets emitted — one stylesheet, two contexts
// :root                    { --color-primary: #C1121F; --color-background: #F5F0EB }
// [data-color-mode="dark"] { --color-primary: #FF2800; --color-background: #0A0A0A }

// Switching — twelve characters that change your entire design system
document.documentElement.setAttribute('data-color-mode', 'dark')`}
          </CodeAltar>
        </Container>
      </Section>

      {/* ═══ VI. THE CLOSE ═══ */}
      <Section py={0}>
        <Container>
          <VerdictLine as="h2" style={{ animationDelay: '0.3s' }}>
            Take it or don't.
          </VerdictLine>
        </Container>
      </Section>

      <VoidFrame py={0} minHeight="40vh">
        <VoidSignature fontSize={{ _: 24, md: 32 }}>
          animus
        </VoidSignature>
      </VoidFrame>

      {/* ─── Footer ─── */}
      <Section bg="backgroundMuted" py={32}>
        <Container>
          <Text
            fontSize={12}
            color="textMuted"
            textAlign="center"
            m={0}
          >
            Built with the extraction pipeline it demonstrates.
          </Text>
        </Container>
      </Section>
    </AppShell>
  );
}
