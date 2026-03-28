import {
  Heading,
  InlineCode,
  Label,
  Mono,
  Prose,
  Stack,
  SyntaxBlock,
} from '../components';

const installCode = `bun add @animus-ui/system @animus-ui/vite-plugin`;

const viteConfigCode = `import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});`;

const designSystemCode = `import { createSystem, createTheme } from '@animus-ui/system';
import { color, space, typography, flex, border } from '@animus-ui/system/groups';

export const tokens = createTheme({
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
})
  .addScale('space', () => ({
    0: '0',
    4: '0.25rem',
    8: '0.5rem',
    16: '1rem',
    24: '1.5rem',
    32: '2rem',
  }))
  .addScale('fontSizes', () => ({
    12: '0.75rem',
    14: '0.875rem',
    16: '1rem',
    18: '1.125rem',
    24: '1.5rem',
  }))
  .addColors({
    void: '#000000',
    coal: '#111111',
    ash: '#2a2a2a',
    smoke: '#555555',
    bone: '#E8E0D0',
    ember: '#FF2800',
    spark: '#FFB627',
  })
  .addColorModes('dark', {
    dark: {
      primary: 'ember',
      background: 'void',
      surface: 'coal',
      text: 'bone',
      textMuted: 'smoke',
      border: 'ash',
    },
    light: {
      primary: 'ember',
      background: 'bone',
      surface: 'ash',
      text: 'coal',
      textMuted: 'smoke',
      border: 'ash',
    },
  })
  .build();

export type MyTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}

export const ds = createSystem()
  .withProperties((p) =>
    p
      .addGroup('surface', { ...color, ...border })
      .addGroup('arrange', { ...flex })
      .addGroup('text', { ...typography })
      .addGroup('space', space)
      .build()
  )
  .build();`;

const importStylesCode = `import 'virtual:animus/styles.css';`;

const componentCode = `import { ds } from './ds';

const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    bg: 'primary',
    color: 'background',
    fontFamily: 'body',
    fontSize: 14,
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      lg: { px: 24, py: 12, fontSize: 18 },
    },
  })
  .groups({ space: true, surface: true })
  .asElement('button');`;

const usageCode = `<Button size="sm">Click me</Button>`;

export default function GettingStarted() {
  return (
    <Stack gap={64}>
      <Stack gap={16}>
        <Prose fontSize={14} color="text-muted" lineHeight="relaxed">
          Prerequisites: React 18+, Vite 5+. <InlineCode>bun</InlineCode> is
          recommended as the package manager.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 1 — Install</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Add both packages. <InlineCode>@animus-ui/system</InlineCode> is the
          builder chain your components use at authoring time.{' '}
          <InlineCode>@animus-ui/vite-plugin</InlineCode> runs the static
          extraction at build time and dev startup.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">terminal</Label>
          <Mono fontSize={13}>{installCode}</Mono>
        </Stack>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 2 — Configure Vite</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Register the plugin and point <InlineCode>system</InlineCode> at your
          design system file. The plugin reads that file at build time to
          evaluate your token definitions and extract all component styles.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">vite.config.ts</Label>
          <SyntaxBlock language="typescript">{viteConfigCode}</SyntaxBlock>
        </Stack>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 3 — Create your design system</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Create <InlineCode>src/ds.ts</InlineCode>. This file is the single
          source of truth: it defines your breakpoints, token scales, color
          modes, and the prop groups available on every component. The{' '}
          <InlineCode>declare module</InlineCode> augmentation makes the builder
          chain fully type-safe — your IDE knows every valid token at every
          prop.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">src/ds.ts</Label>
          <SyntaxBlock language="typescript">{designSystemCode}</SyntaxBlock>
        </Stack>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 4 — Import the virtual stylesheet</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Add one import to <InlineCode>src/main.tsx</InlineCode>. The virtual
          module <InlineCode>virtual:animus/styles.css</InlineCode> is resolved
          by the Vite plugin and contains all CSS extracted from your component
          definitions. Nothing is shipped to the browser at runtime.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">src/main.tsx</Label>
          <SyntaxBlock language="typescript">{importStylesCode}</SyntaxBlock>
        </Stack>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 5 — Build your first component</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Call <InlineCode>ds.styles()</InlineCode> to define base styles, chain{' '}
          <InlineCode>.variant()</InlineCode> to add prop-driven variants, opt
          into prop groups with <InlineCode>.groups()</InlineCode>, then seal
          with <InlineCode>.asElement()</InlineCode> to produce a typed React
          component. The extraction pipeline reads this file statically — all
          style values must be string or number literals.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">src/components/Button.tsx</Label>
          <SyntaxBlock language="typescript">{componentCode}</SyntaxBlock>
        </Stack>
        <Stack gap={8}>
          <Label color="text-muted">usage</Label>
          <SyntaxBlock language="tsx">{usageCode}</SyntaxBlock>
        </Stack>
        <Prose fontSize={13} color="text-muted" lineHeight="relaxed">
          Note: <InlineCode>px: 16</InlineCode> resolves to the{' '}
          <InlineCode>16</InlineCode> key in your space scale (
          <InlineCode>1rem</InlineCode>), not 16 pixels. Numeric values that
          match a prop group&apos;s scale are token references.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>Step 6 — Build and verify</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Run the build. The plugin extracts every component style into layered
          CSS at compile time. The output bundle will contain only CSS for your
          components — no JavaScript styling runtime.
        </Prose>
        <Stack gap={8}>
          <Label color="text-muted">terminal</Label>
          <Mono fontSize={13}>bun run build</Mono>
        </Stack>
        <Prose fontSize={14} lineHeight="relaxed">
          Inspect <InlineCode>dist/assets/*.css</InlineCode>. You will find base
          styles in <InlineCode>@layer base</InlineCode> and variant overrides
          in <InlineCode>@layer variants</InlineCode>. Every layer is explicit —
          no specificity surprises.
        </Prose>
      </Stack>
    </Stack>
  );
}
