import { ds } from '../ds';
import { Stack, Slab, Prose, Display, Label, Mono, SectionLabel } from '../components';

const Section = ds
  .styles({
    py: 64,
  })
  .groups({ space: true, surface: true })
  .asElement('section');

const Code = ds
  .styles({
    fontFamily: 'mono',
    fontSize: '13px',
    bg: 'coal',
    color: 'spark',
    px: 4,
    py: 2,
    borderRadius: '0',
  })
  .asElement('code');

export default function Docs() {
  return (
    <Slab px={{ _: 24, md: 48 }}>
      <Stack gap={64} maxWidth="48rem" mx="auto">
        <Section>
          <Stack gap={32}>
            <SectionLabel>Getting Started</SectionLabel>
            <Display fontSize={{ _: 24, md: 40 }} lineHeight="tight">
              Installation
            </Display>
            <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
              Animus is a static CSS extraction system for React. You write
              TypeScript component definitions using the builder chain, and the
              Vite plugin extracts them to atomic CSS at build time. Zero
              runtime.
            </Prose>
            <Stack gap={8}>
              <Label color="textMuted">install</Label>
              <Mono fontSize={13} color="spark">
                bun add @animus-ui/system @animus-ui/vite-plugin
              </Mono>
            </Stack>
          </Stack>
        </Section>

        <Section>
          <Stack gap={32}>
            <SectionLabel>The Builder Chain</SectionLabel>
            <Prose fontSize={{ _: 14, md: 16 }} lineHeight="relaxed">
              Every component starts with <Code>ds.styles()</Code> and flows
              through a builder chain. Each method maps to a CSS{' '}
              <Code>@layer</Code>. The chain is fully type-safe — your IDE
              knows every valid token at every position.
            </Prose>
            <Stack gap={8}>
              <Label color="textMuted">anatomy</Label>
              <Mono fontSize={13} color="text">
                ds.styles() → .variant() → .states() → .groups() → .asElement()
              </Mono>
            </Stack>
          </Stack>
        </Section>
      </Stack>
    </Slab>
  );
}
