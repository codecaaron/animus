import {
  CodeExample,
  Heading,
  InlineCode,
  Label,
  Mono,
  Prose,
  Stack,
  SyntaxBlock,
} from '../components';

// ─── Section 1: The Builder Chain ────────────────────────────────────────────

const builderChainLayerMap = `\
ds
  .styles(config)    // @layer base      — unconditional defaults
  .variant(config)   // @layer variants  — named prop options
  .compound(cond, s) // @layer compounds — multi-condition overrides
  .states(config)    // @layer states    — boolean toggles
  .groups(config)    // @layer system    — responsive prop groups
  .props(config)     // @layer custom    — custom CSS property slots
  .asElement('div')  // sealed component`;

const builderChainExample = {
  input: `\
import { ds } from './ds';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    fontFamily: 'mono',
    fontSize: 14,
    borderRadius: 2,
    cursor: 'pointer',
    bg: 'coal',
    color: 'text',
    border: '1px solid',
    borderColor: 'ash',
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    {},
      primary: { bg: 'primary', color: 'background', borderColor: 'primary' },
      ghost:   { bg: 'transparent', borderColor: 'transparent' },
    },
  })
  .compound(
    { intent: 'primary', disabled: true },
    { opacity: '0.4', cursor: 'not-allowed' },
  )
  .states({
    disabled: { opacity: '0.5', cursor: 'not-allowed' },
  })
  .groups({ space: true, arrange: true })
  .asElement('button');`,

  output: `\
/* @layer base — .styles() */
@layer base {
  .animus-Button-a1b2c3 {
    display: inline-flex;
    align-items: center;
    padding-inline: 16px;
    padding-block: 8px;
    font-family: var(--font-mono);
    font-size: 14px;
    border-radius: 2px;
    cursor: pointer;
    background: var(--color-coal);
    color: var(--color-text);
    border: 1px solid var(--color-ash);
  }
}

/* @layer variants — .variant() */
@layer variants {
  .animus-Button-a1b2c3[data-intent="primary"] {
    background: var(--color-primary);
    color: var(--color-background);
    border-color: var(--color-primary);
  }
  .animus-Button-a1b2c3[data-intent="ghost"] {
    background: transparent;
    border-color: transparent;
  }
}

/* @layer compounds — .compound() */
@layer compounds {
  .animus-Button-a1b2c3[data-intent="primary"][data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

/* @layer states — .states() */
@layer states {
  .animus-Button-a1b2c3[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* @layer system — .groups() per-breakpoint utility classes */
@layer system {
  .bp-px-16 { padding-inline: 16px; }
  .bp-py-8  { padding-block: 8px; }
}`,
};

const extendExample = `\
// .extend() reopens a sealed component to append new layers.
// Styles, groups, and props are deep-merged with the parent.

const LargeButton = Button.extend()
  .variant({
    prop: 'size',
    variants: {
      base: { px: 16, py: 8 },
      sm:   { px: 10, py: 4, fontSize: 12 },
      lg:   { px: 24, py: 12, fontSize: 16 },
    },
  })
  .asElement('button');`;

// ─── Section 2: The Cascade Contract ─────────────────────────────────────────

const cascadeLayerDeclaration = `\
@layer global, base, variants, compounds, states, system, custom;`;

const cascadeContractExample = {
  input: `\
export const Card = ds
  .styles({
    // @layer base: applied unconditionally
    bg: 'coal',
    p: 24,
    borderRadius: 4,
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    {},
      ember:   { bg: 'ember' },   // @layer variants: overrides base
      surface: { bg: 'surface' },
    },
  })
  .states({
    // @layer states: overrides both base AND variant — no !important
    selected: { bg: 'primary', borderColor: 'primary' },
  })
  .asElement('div');`,

  output: `\
@layer base {
  .animus-Card-d4e5f6 {
    background: var(--color-coal);
    padding: 24px;
    border-radius: 4px;
  }
}

@layer variants {
  /* Wins over base when intent="ember" */
  .animus-Card-d4e5f6[data-intent="ember"] {
    background: var(--color-ember);
  }
  .animus-Card-d4e5f6[data-intent="surface"] {
    background: var(--color-surface);
  }
}

@layer states {
  /* Wins over base AND variant — layer position, not !important */
  .animus-Card-d4e5f6[data-selected] {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
}`,
};

// ─── Section 3: Design Tokens ─────────────────────────────────────────────────

const tokenDefinitionExample = {
  input: `\
import { createTheme } from '@animus-ui/system';

export const tokens = createTheme({
  colors: {
    primary:    '#e05c2a',
    background: '#0d0d0d',
    text:       '#f0ece4',
    textMuted:  '#6b6660',
    ember:      '#a83216',
    ash:        '#2a2826',
    coal:       '#1a1816',
  },
})
  .addScale('space', (n: number) => \`\${n * 4}px\`)
  .addScale('fontSizes', (n: number) => \`\${n}px\`)
  .addColorModes('dark', {
    dark:  { background: '#0d0d0d', surface: '#181818', text: '#f0ece4' },
    light: { background: '#f5f0e8', surface: '#ece8df', text: '#1a1714' },
  })
  .build();`,

  output: `\
/* Base tokens — always on :root */
:root {
  --color-primary:    #e05c2a;
  --color-background: #0d0d0d;
  --color-text:       #f0ece4;
  --color-text-muted: #6b6660;
  --color-ember:      #a83216;
  --color-ash:        #2a2826;
  --color-coal:       #1a1816;
}

/* initialMode="dark" → resolves into :root */
:root {
  --color-surface: #181818;
}

/* Other modes → [data-color-mode] selector */
[data-color-mode="light"] {
  --color-background: #f5f0e8;
  --color-surface:    #ece8df;
  --color-text:       #1a1714;
}`,
};

const tokenAliasingExample = {
  input: `\
export const Overlay = ds
  .styles({
    // {colors.primary/40} → primary color at 40% opacity
    bg: '{colors.primary/40}',
    backdropFilter: 'blur(8px)',
    border: '1px solid',
    // {colors.ember/20} → ember at 20% opacity
    borderColor: '{colors.ember/20}',
  })
  .asElement('div');`,

  output: `\
@layer base {
  .animus-Overlay-x9y0z1 {
    background: color-mix(in srgb, var(--color-primary) 40%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid;
    border-color: color-mix(in srgb, var(--color-ember) 20%, transparent);
  }
}`,
};

// ─── Section 4: Responsive Props ──────────────────────────────────────────────

const responsiveExample = {
  input: `\
export const Article = ds
  .styles({ color: 'text' })
  .groups({ text: true, space: true })
  .asElement('article');

// _ is the base breakpoint — no media query.
// Named keys map to breakpoints in your system config.
<Article
  fontSize={{ _: 14, md: 16, lg: 18 }}
  px={{ _: 16, md: 48, lg: 80 }}
/>`,

  output: `\
/* Base — no media query */
@layer system {
  .bp-fontSize-14 { font-size: 14px; }
  .bp-px-16       { padding-inline: 16px; }
}

/* md breakpoint */
@media (min-width: 768px) {
  @layer system {
    .bp-md-fontSize-16 { font-size: 16px; }
    .bp-md-px-48       { padding-inline: 48px; }
  }
}

/* lg breakpoint */
@media (min-width: 1024px) {
  @layer system {
    .bp-lg-fontSize-18 { font-size: 18px; }
    .bp-lg-px-80       { padding-inline: 80px; }
  }
}`,
};

// ─── Section 5: Variants & States ─────────────────────────────────────────────

const variantExample = {
  input: `\
export const Badge = ds
  .styles({
    display: 'inline-flex',
    px: 8,
    py: 2,
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  })
  .variant({
    prop: 'status',
    defaultVariant: 'base',
    variants: {
      base:    { bg: 'ash',     color: 'textMuted' },
      active:  { bg: 'primary', color: 'background' },
      success: { bg: 'success', color: 'background' },
    },
  })
  .asElement('span');

// Usage
<Badge status="active">Live</Badge>`,

  output: `\
@layer base {
  .animus-Badge-g7h8i9 {
    display: inline-flex;
    padding-inline: 8px;
    padding-block: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
}

@layer variants {
  /* defaultVariant="base" emits without a data attribute */
  .animus-Badge-g7h8i9 {
    background: var(--color-ash);
    color: var(--color-text-muted);
  }
  .animus-Badge-g7h8i9[data-status="active"] {
    background: var(--color-primary);
    color: var(--color-background);
  }
  .animus-Badge-g7h8i9[data-status="success"] {
    background: var(--color-success);
    color: var(--color-background);
  }
}`,
};

const compoundExample = {
  input: `\
export const Chip = ds
  .styles({ display: 'inline-flex', px: 12, py: 4 })
  .variant({
    prop: 'size',
    variants: {
      base: { fontSize: 13 },
      lg:   { fontSize: 16 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    { bg: 'coal' },
      primary: { bg: 'primary', color: 'background' },
    },
  })
  // Two args: condition object, then style object.
  // Single values → exact match.
  .compound(
    { size: 'lg', intent: 'primary' },
    { fontWeight: '600', letterSpacing: '0.05em' },
  )
  // Array values → expands to one selector per combination.
  .compound(
    { size: ['base', 'lg'], intent: 'primary' },
    { textTransform: 'uppercase' },
  )
  .asElement('span');`,

  output: `\
@layer compounds {
  /* Single condition — both props must match exactly */
  .animus-Chip-j0k1l2[data-size="lg"][data-intent="primary"] {
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  /* Array condition — expanded into a selector list */
  .animus-Chip-j0k1l2[data-size="base"][data-intent="primary"],
  .animus-Chip-j0k1l2[data-size="lg"][data-intent="primary"] {
    text-transform: uppercase;
  }
}`,
};

const statesExample = {
  input: `\
export const Input = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    px: 12,
    py: 8,
    bg: 'coal',
    color: 'text',
    border: '1px solid',
    borderColor: 'ash',
    outline: 'none',
  })
  .states({
    focused:  { borderColor: 'primary' },
    invalid:  { borderColor: 'error' },
    disabled: { opacity: '0.4', cursor: 'not-allowed' },
  })
  .asElement('input');

// States are boolean props. No variant logic — just on/off.
<Input focused={isFocused} invalid={hasError} />`,

  output: `\
@layer states {
  /* Each key becomes [data-key] — sits above variants and compounds */
  .animus-Input-m3n4o5[data-focused] {
    border-color: var(--color-primary);
  }
  .animus-Input-m3n4o5[data-invalid] {
    border-color: var(--color-error);
  }
  .animus-Input-m3n4o5[data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
}`,
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Concepts() {
  return (
    <Stack gap={64}>
      {/* ── 1. The Builder Chain ───────────────────────────────────────────── */}
      <Stack gap={16}>
        <Heading level={2}>The Builder Chain</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          Every Animus component is assembled by chaining methods on your design
          system instance. Each method writes into a specific{' '}
          <InlineCode>@layer</InlineCode> of the CSS cascade. The chain is
          sealed by <InlineCode>.asElement(tag)</InlineCode>, which produces a
          fully typed React component with all variant and state props inferred
          from the chain.
        </Prose>

        <Stack gap={8}>
          <Label color="text-muted">method → layer</Label>
          <SyntaxBlock language="tsx">{builderChainLayerMap}</SyntaxBlock>
        </Stack>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>.styles(config)</InlineCode> sets unconditional defaults
          in <InlineCode>@layer base</InlineCode>. Every selector emitted is a
          single class — no nesting, no specificity escalation.{' '}
          <InlineCode>
            .variant(&#123; prop, variants, defaultVariant, base &#125;)
          </InlineCode>{' '}
          declares a named prop and maps its values to style objects in{' '}
          <InlineCode>@layer variants</InlineCode>. The{' '}
          <InlineCode>prop</InlineCode> key defaults to{' '}
          <InlineCode>'variant'</InlineCode> when omitted. Chain multiple{' '}
          <InlineCode>.variant()</InlineCode> calls to introduce multiple
          independent axes.
        </Prose>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>.compound(condition, styles)</InlineCode> takes exactly
          two arguments and writes to <InlineCode>@layer compounds</InlineCode>.
          Condition values can be arrays to match multiple variant values at
          once. <InlineCode>.states(config)</InlineCode> declares boolean toggle
          props in <InlineCode>@layer states</InlineCode> — they sit above
          variants and compounds and require no qualification to win.{' '}
          <InlineCode>.groups(config)</InlineCode> enables responsive prop
          groups (e.g. <InlineCode>&#123; space: true &#125;</InlineCode>) whose
          classes are shared and de-duplicated across the system in{' '}
          <InlineCode>@layer system</InlineCode>.{' '}
          <InlineCode>.props(config)</InlineCode> registers custom CSS property
          slots in <InlineCode>@layer custom</InlineCode>, each with an optional
          scale, transform, and variable binding.
        </Prose>

        <Heading level={3}>Composition with .extend()</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>.extend()</InlineCode> reopens a sealed component and
          returns a new builder that deep-merges styles, groups, and props from
          the parent. New layers are appended after the inherited ones. The
          original component is unchanged.
        </Prose>

        <SyntaxBlock language="tsx">{extendExample}</SyntaxBlock>

        <Heading level={3}>Full example</Heading>

        <CodeExample
          input={builderChainExample.input}
          output={builderChainExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />
      </Stack>

      {/* ── 2. The Cascade Contract ────────────────────────────────────────── */}
      <Stack gap={16}>
        <Heading level={2}>The Cascade Contract</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          Animus declares a fixed seven-layer cascade at build time. Layer order
          determines precedence — not selector specificity. Every selector
          emitted by the builder is a single class. You never need{' '}
          <InlineCode>!important</InlineCode>, and there are no specificity
          conflicts between component styles.
        </Prose>

        <Stack gap={8}>
          <Label color="text-muted">layer order — low to high precedence</Label>
          <SyntaxBlock language="css">{cascadeLayerDeclaration}</SyntaxBlock>
        </Stack>

        <Prose fontSize={16} lineHeight="relaxed">
          <Mono>global</Mono> holds reset and base HTML element styles
          registered via <InlineCode>.withGlobalStyles()</InlineCode>.{' '}
          <Mono>base</Mono> holds the component defaults from{' '}
          <InlineCode>.styles()</InlineCode> — the lowest component-level
          precedence. <Mono>variants</Mono> overrides base when a variant prop
          matches. <Mono>compounds</Mono> overrides both base and variants when
          all conditions in a <InlineCode>.compound()</InlineCode> call are met.{' '}
          <Mono>states</Mono> always wins over variants and compounds — pass the
          boolean prop and the styles apply regardless of what variant is
          active. <Mono>system</Mono> holds the shared responsive utility
          classes from <InlineCode>.groups()</InlineCode>. <Mono>custom</Mono>{' '}
          is reserved for <InlineCode>.props()</InlineCode> slots — it beats
          every other Animus layer.
        </Prose>

        <Heading level={3}>Concrete example</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          A <InlineCode>Card</InlineCode> with a base background, a variant that
          overrides it, and a state that overrides both — all resolved by layer
          position alone, with no selector gymnastics.
        </Prose>

        <CodeExample
          input={cascadeContractExample.input}
          output={cascadeContractExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />
      </Stack>

      {/* ── 3. Design Tokens ───────────────────────────────────────────────── */}
      <Stack gap={16}>
        <Heading level={2}>Design Tokens</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          Tokens are defined with <InlineCode>createTheme(base)</InlineCode> and
          organised into scales. Every token becomes a CSS custom property on{' '}
          <InlineCode>:root</InlineCode>. When you write{' '}
          <InlineCode>bg: 'primary'</InlineCode> in a style block, the Rust
          extractor resolves it to <InlineCode>var(--color-primary)</InlineCode>{' '}
          at build time — no runtime token lookup.
        </Prose>

        <Prose fontSize={16} lineHeight="relaxed">
          The builder chain is: <InlineCode>createTheme(base)</InlineCode> →{' '}
          <InlineCode>.addScale(key, factory)</InlineCode> →{' '}
          <InlineCode>.addColors(colors)</InlineCode> →{' '}
          <InlineCode>.addColorModes(initialMode, modes)</InlineCode> →{' '}
          <InlineCode>.build()</InlineCode>. The{' '}
          <InlineCode>initialMode</InlineCode> argument to{' '}
          <InlineCode>addColorModes</InlineCode> determines which mode resolves
          into <InlineCode>:root</InlineCode>. Every other mode gets a{' '}
          <InlineCode>[data-color-mode="mode"]</InlineCode> selector. Components
          that reference token values adapt automatically — no conditional
          rendering required.
        </Prose>

        <CodeExample
          input={tokenDefinitionExample.input}
          output={tokenDefinitionExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />

        <Heading level={3}>Token aliasing</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          The <InlineCode>{'{colors.x/N}'}</InlineCode> syntax creates an
          alpha-modified reference to any color token.{' '}
          <InlineCode>N</InlineCode> is a percentage from 0 to 100. The
          extractor resolves this to a{' '}
          <InlineCode>
            color-mix(in srgb, var(--color-x) N%, transparent)
          </InlineCode>{' '}
          call at build time — the browser never sees the alias syntax.
        </Prose>

        <CodeExample
          input={tokenAliasingExample.input}
          output={tokenAliasingExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />
      </Stack>

      {/* ── 4. Responsive Props ────────────────────────────────────────────── */}
      <Stack gap={16}>
        <Heading level={2}>Responsive Props</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          Any prop exposed by <InlineCode>.groups()</InlineCode> accepts either
          a scalar value or a breakpoint object. The key{' '}
          <InlineCode>_</InlineCode> is the base — applied without a media
          query. Named keys correspond to breakpoints defined in your system
          configuration. Both forms are valid on the same prop at the same time.
        </Prose>

        <Stack gap={8}>
          <Label color="text-muted">scalar vs. breakpoint object</Label>
          <SyntaxBlock language="tsx">
            {`// Scalar — applied at all breakpoints
<Text fontSize={14} />

// Breakpoint object — _ is base, named keys add media queries
<Text fontSize={{ _: 14, md: 16, lg: 18 }} />`}
          </SyntaxBlock>
        </Stack>

        <Prose fontSize={16} lineHeight="relaxed">
          Each unique prop/value/breakpoint triple generates exactly one utility
          class. Classes are de-duplicated globally — if two components both use{' '}
          <InlineCode>fontSize=16</InlineCode> at <InlineCode>md</InlineCode>,
          that class is emitted once and shared between them. The extracted CSS
          never grows proportionally to how many components use a given value.
        </Prose>

        <CodeExample
          input={responsiveExample.input}
          output={responsiveExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />
      </Stack>

      {/* ── 5. Variants & States ───────────────────────────────────────────── */}
      <Stack gap={16}>
        <Heading level={2}>Variants {'&'} States</Heading>

        <Heading level={3}>Variants</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>
            .variant(&#123; prop, variants, defaultVariant, base &#125;)
          </InlineCode>{' '}
          declares a named prop and a map of style objects. The{' '}
          <InlineCode>prop</InlineCode> key defaults to{' '}
          <InlineCode>'variant'</InlineCode> when omitted. Each entry in{' '}
          <InlineCode>variants</InlineCode> produces a{' '}
          <InlineCode>[data-prop="value"]</InlineCode> rule in{' '}
          <InlineCode>@layer variants</InlineCode>. When{' '}
          <InlineCode>defaultVariant</InlineCode> is specified, that variant's
          styles are emitted without a data attribute so they apply by default.
          The <InlineCode>base</InlineCode> key in the config provides styles
          shared across all variants before per-variant overrides are applied.
        </Prose>

        <CodeExample
          input={variantExample.input}
          output={variantExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />

        <Heading level={3}>Compound variants</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>.compound(condition, styles)</InlineCode> takes exactly
          two arguments. The first is a condition object mapping prop names to
          the values that must be active simultaneously. The second is the style
          object to apply when all conditions are met. A condition value can be
          a single string for an exact match, or an array of strings — arrays
          are expanded into a selector list, one rule per combination.
        </Prose>

        <CodeExample
          input={compoundExample.input}
          output={compoundExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />

        <Heading level={3}>States</Heading>

        <Prose fontSize={16} lineHeight="relaxed">
          <InlineCode>.states(config)</InlineCode> takes a{' '}
          <InlineCode>
            Record{'<'}string, CSS{'>'}
          </InlineCode>{' '}
          and declares boolean toggle props. Each key becomes a prop on the
          React component and a <InlineCode>[data-key]</InlineCode> attribute
          selector in <InlineCode>@layer states</InlineCode>. Because states
          occupy the highest component-owned layer, they override any active
          variant or compound unconditionally — no selector qualification
          needed.
        </Prose>

        <CodeExample
          input={statesExample.input}
          output={statesExample.output}
          inputLabel="surface"
          outputLabel="substrate"
        />
      </Stack>
    </Stack>
  );
}
