import { Button as TestDsButton, Card as TestDsCard } from '@animus-ui/test-ds';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, ButtonDisplay, ButtonLink } from '../components/docs/Button';
import { Heading } from '../components/docs/Heading';
import { Card } from '../components/surfaces/Card';
import { SyntaxBlock } from '../components/surfaces/SyntaxBlock';
import { Tooltip } from '../components/surfaces/Tooltip';
import { ds } from '../ds';

const PageWrapper = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 48,
    pb: 96,
    minWidth: '0',
    maxWidth: '100%',
  })
  .asElement('div');

const Section = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  })
  .asElement('section');

const MatrixGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'auto repeat(5, auto)',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'start',
  })
  .asElement('div');

const RowLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.muted',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    pr: 8,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  })
  .asElement('div');

const ColHeader = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'center',
    pb: 4,
  })
  .asElement('div');

const TabBar = ds
  .styles({
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  })
  .asElement('div');

const SizeRow = ds
  .styles({
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  })
  .asElement('div');

const Intro = ds
  .styles({
    fontFamily: 'body',
    fontSize: 14,
    lineHeight: 'relaxed',
    color: 'text.muted',
    maxWidth: '48rem',
  })
  .asElement('p');

const CodeSection = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: '48rem',
    minWidth: '0',
    overflow: 'hidden',
  })
  .asElement('div');

// ─── Custom prop transform demo ─────────────────────────────────────────────
// Exercises inline transform capture: Rust extracts the function body from the
// AST and emits it directly in the replacement JS.

const Swatch = ds
  .styles({
    transition: '200ms ease all',
  })
  .system({ surface: true, space: true })
  .props({
    sizing: {
      property: 'width',
      transform: (value: string | number) =>
        typeof value === 'number'
          ? value <= 1 && value >= -1
            ? `${value * 100}%`
            : `${value}px`
          : value,
    },
    depth: {
      property: 'boxShadow',
      scale: {
        sm: '0 1px 3px rgba(0,0,0,0.3)',
        md: '0 4px 12px rgba(0,0,0,0.4)',
        lg: '0 8px 24px rgba(0,0,0,0.5)',
      },
    },
  })
  .asElement('div');

// ─── Selector alias demo ────────────────────────────────────────────────────
// Exercises _hover, _disabled, _before, _after, _focusVisible in style objects.
// Extraction expands aliases → CSS pseudo selectors in the correct layer.

const AliasCard = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    p: 24,
    borderRadius: '8px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'bg.muted',
    transition: '200ms ease all',
    cursor: 'pointer',
    _hover: {
      borderColor: 'primary',
      bg: 'bg',
    },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '2px',
    },
    _disabled: {
      opacity: '0.4',
      cursor: 'not-allowed',
    },
  })
  .asElement('div');

const AliasTag = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'mono',
    fontSize: 11,
    lineHeight: '1',
    px: 8,
    py: 4,
    borderRadius: '4px',
    bg: 'surface',
    color: 'text.muted',
    _before: {
      display: 'inline-block',
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      bg: 'primary',
      mr: 8,
    },
  })
  .variant({
    prop: 'status',
    variants: {
      active: {
        _before: { bg: 'status.success' },
      },
      warning: {
        _before: { bg: 'status.warning' },
      },
      error: {
        _before: { bg: 'status.error' },
      },
    },
  })
  .asElement('span');

const ALIAS_CODE = `// _hover, _disabled, _focusVisible — typed aliases
const Card = ds.styles({
  bg: 'bg.muted',
  borderColor: 'border',
  transition: '200ms ease all',
  _hover: { borderColor: 'primary', bg: 'bg' },
  _focusVisible: { outline: '2px solid', outlineColor: 'primary' },
  _disabled: { opacity: '0.4', cursor: 'not-allowed' },
}).asElement('div');

// _before with auto-defaulted content: ""
const Tag = ds.styles({
  _before: { display: 'inline-block', bg: 'primary', ... },
}).variant({
  prop: 'status',
  variants: {
    active:  { _before: { bg: 'success' } },
    warning: { _before: { bg: 'warning' } },
    error:   { _before: { bg: 'danger' } },
  },
}).asElement('span');`;

const ComposeGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    alignItems: 'start',
  })
  .asElement('div');

const COMPOSE_CODE = `// Slots are independent Animus components.
// compose() seals them into a family.
const Card = compose(
  { Root: CardRoot, Header: CardHeader, Body: CardBody, Footer: CardFooter },
  { shared: { density: true } }
);

// Root receives the shared prop. Children inherit via CSS cascade.
// Direct props on a child override the inherited value.
<Card.Root density="compact" variant="elevated">
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
  <Card.Footer><Button>Action</Button></Card.Footer>
</Card.Root>`;

const TOOLTIP_CODE = `// context: true — shared variants cross portal boundaries
const Tooltip = compose(
  { Root: TooltipRoot, Content: TooltipContent },
  { shared: { size: true }, context: true }
);

// Content renders via createPortal into document.body.
// CSS descendant selectors can't reach it, but React
// context carries the shared \`size\` prop through.
<Tooltip.Root size="lg">
  <span>hover target</span>
  {createPortal(<Tooltip.Content>portaled</Tooltip.Content>, document.body)}
</Tooltip.Root>`;

const AS_CHILD_CODE = `// asChild — type-safe polymorphism via child delegation
const Button = ds.styles({ ... }).variant({
  prop: 'kind',
  variants: { fill: { ... }, ghost: { ... } },
}).asElement('button');

// Without asChild: renders <button>, \`href\` is untyped
<Button as="a" href="/foo">Link</Button>

// With asChild: renders <a>, full anchor type safety
<Button kind="ghost" asChild>
  <a href="/dashboard">Dashboard</a>
</Button>
// Output: <a href="/dashboard" class="animus-Button-xxx ...">`;

const COLORS = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
] as const;
const KINDS = ['fill', 'outline', 'ghost', 'subtle'] as const;
const STATES = ['default', 'hover', 'active', 'focus', 'disabled'] as const;

const CYCLE_MS = 3000;

function stateDataAttr(state: string) {
  if (state === 'default') return undefined;
  return state;
}

const USAGE_CODE = `// One component — five schemes, four styles, three sizes
<Button color="success" kind="outline" size="md">
  Save Changes
</Button>

<Button color="danger" kind="fill" size="sm">
  Delete
</Button>

<Button color="warning" kind="subtle" size="lg">
  Review
</Button>`;

const THEME_COMPOSE_CODE = `// Extend a library's reference theme with from()
import { createTheme } from '@animus-ui/system';
import { referenceTokens } from '@acme/design-system';

const tokens = createTheme()
  .from(referenceTokens)                    // deep merge everything
  .addColors({ brand: { 500: '#cc5500' } }) // augment with new colors
  .addScale({                                // add new scales
    name: 'fontSizes',
    values: { 14: '0.875rem', 16: '1rem', 24: '1.5rem' },
  })
  .build();

// Library components render against your theme.
// Token paths like bg: 'surface' resolve to your CSS variables.`;

const EXTEND_CODE = `// .extend() inherits the full chain — styles, variants, system config.
// Only the terminal changes.

// Element swap: Button → anchor
const ButtonLink = Button.extend().asElement('a');

// Additive styles: layer new CSS on top of the base
const ButtonDisplay = Button.extend()
  .styles({
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: 700,
  })
  .asElement('button');

// Both inherit color, kind, and size variants from Button.
// Extraction emits parent and child to the same @layer, source-ordered.`;

const SCHEME_CODE = `// Color variants rebind --color-scheme-* weights.
// Style variants pick which weights map to which properties.
// The component never references a palette directly.

.variant({
  prop: 'color',
  variants: {
    primary: {},           // inherits mode defaults
    success: {
      '--color-scheme-500': '{colors.forest.500}',
      '--color-scheme-600': '{colors.forest.600}',
      // ... full palette rebind
    },
  },
})
.variant({
  prop: 'kind',
  variants: {
    fill:    { bg: 'scheme.500', color: 'scheme.50' },
    outline: { borderColor: 'scheme.400', color: 'scheme.400' },
    ghost:   { color: 'scheme.400' },
    subtle:  { bg: 'scheme.800', color: 'scheme.200' },
  },
})`;

function ComposeSection() {
  const [density, setDensity] = useState<'compact' | 'comfortable'>(
    'comfortable'
  );

  return (
    <Section>
      <Heading as="h2" id="slot-composition">
        Slot Composition
      </Heading>
      <Intro>
        <code>compose()</code> seals independent components into a family with
        shared variant propagation. One prop on Root, every slot responds — via
        pure CSS cascade, zero React context. Direct props on children override.
      </Intro>

      <TabBar>
        <Button
          color="primary"
          kind={density === 'compact' ? 'subtle' : 'ghost'}
          size="sm"
          onClick={() => setDensity('compact')}
        >
          compact
        </Button>
        <Button
          color="primary"
          kind={density === 'comfortable' ? 'subtle' : 'ghost'}
          size="sm"
          onClick={() => setDensity('comfortable')}
        >
          comfortable
        </Button>
      </TabBar>

      <ComposeGrid>
        <Card.Root density={density} variant="elevated">
          <Card.Header>Elevated</Card.Header>
          <Card.Body>
            Shared density flows from Root to all slots via CSS descendant
            selectors. No context, no providers.
          </Card.Body>
          <Card.Footer>
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density={density} variant="outlined">
          <Card.Header>Outlined</Card.Header>
          <Card.Body>
            Toggle density above — Root applies its variant class, CSS cascade
            carries the styles to every child.
          </Card.Body>
          <Card.Footer>
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density={density} variant="ghost">
          <Card.Header>Ghost</Card.Header>
          <Card.Body>
            Non-shared variants like <code>variant</code> stay local to Root.
            Children are unaffected.
          </Card.Body>
          <Card.Footer>
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>
      </ComposeGrid>

      <Heading as="h3">Per-slot overrides</Heading>
      <Intro>
        A direct prop on a child slot overrides the inherited value. Below, Root
        is <code>compact</code> but Body overrides to <code>comfortable</code> —
        the CSS override rule wins via source order at equal specificity.
      </Intro>

      <ComposeGrid>
        <Card.Root density="compact" variant="elevated">
          <Card.Header>All compact</Card.Header>
          <Card.Body>
            Every slot inherits compact from Root. Tight spacing everywhere.
          </Card.Body>
          <Card.Footer>
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density="compact" variant="elevated">
          <Card.Header>Header compact</Card.Header>
          <Card.Body density="comfortable">
            Body overrides to comfortable. Header and Footer stay compact via
            inheritance.
          </Card.Body>
          <Card.Footer>
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density="comfortable" variant="elevated">
          <Card.Header density="compact">Compact header</Card.Header>
          <Card.Body>
            Body inherits comfortable from Root. Header overrides to compact
            independently.
          </Card.Body>
          <Card.Footer density="compact">
            <Button color="primary" size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>
      </ComposeGrid>

      <CodeSection>
        <SyntaxBlock language="tsx">{COMPOSE_CODE}</SyntaxBlock>
      </CodeSection>
    </Section>
  );
}

export default function Examples() {
  const [activeColor, setActiveColor] =
    useState<(typeof COLORS)[number]>('primary');
  const [cycling, setCycling] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCycling = useCallback(() => {
    setCycling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!cycling) return;
    intervalRef.current = setInterval(() => {
      setActiveColor((prev) => {
        const idx = COLORS.indexOf(prev);
        return COLORS[(idx + 1) % COLORS.length];
      });
    }, CYCLE_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cycling]);

  function selectColor(color: (typeof COLORS)[number]) {
    stopCycling();
    setActiveColor(color);
  }

  return (
    <PageWrapper>
      <div>
        <Heading as="h2" id="component-matrix">
          Component Matrix
        </Heading>
        <Intro>
          One definition. Five color schemes. Four style variants. Color
          variants rebind <code>--color-scheme-*</code> weights — the style
          variants pick which weights map to which CSS properties. The matrix
          below cycles through each scheme automatically.
        </Intro>
      </div>

      <Section>
        <TabBar>
          {COLORS.map((color) => (
            <Button
              key={color}
              color={color}
              kind={activeColor === color ? 'subtle' : 'ghost'}
              size="sm"
              onClick={() => selectColor(color)}
            >
              {color}
            </Button>
          ))}
        </TabBar>

        <MatrixGrid>
          <div />
          {STATES.map((s) => (
            <ColHeader key={s}>{s}</ColHeader>
          ))}

          {KINDS.map((kind) => (
            <>
              <RowLabel key={`${kind}-label`}>{kind}</RowLabel>
              {STATES.map((state) => (
                <div key={`${kind}-${state}`}>
                  <Button
                    color={activeColor}
                    kind={kind}
                    size="md"
                    data-state={stateDataAttr(state)}
                  >
                    Button
                  </Button>
                </div>
              ))}
            </>
          ))}
        </MatrixGrid>

        <div>
          <Heading as="h3">Sizes</Heading>
          <SizeRow>
            <Button color={activeColor} kind="fill" size="sm">
              sm
            </Button>
            <Button color={activeColor} kind="fill" size="md">
              md
            </Button>
            <Button color={activeColor} kind="fill" size="lg">
              lg
            </Button>
          </SizeRow>
        </div>
      </Section>

      <Section>
        <Heading as="h2" id="usage">
          Usage
        </Heading>
        <CodeSection>
          <SyntaxBlock language="tsx">{USAGE_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2" id="external-packages">
          External Package Components
        </Heading>
        <Intro>
          Components imported from @animus-ui/test-ds — an external workspace
          package. Styles are extracted against the consumer theme.
        </Intro>
        <SizeRow>
          <TestDsButton variant="primary" px={16} py={8}>
            Primary
          </TestDsButton>
          <TestDsButton variant="secondary" px={16} py={8}>
            Secondary
          </TestDsButton>
          <TestDsButton variant="ghost" px={16} py={8}>
            Ghost
          </TestDsButton>
        </SizeRow>
        <TestDsCard>
          Card component from test-ds with surface background and text color.
        </TestDsCard>
      </Section>

      <Section>
        <Heading as="h2" id="theme-composition">
          Theme Composition
        </Heading>
        <Intro>
          <code>.from()</code> deep merges a library&apos;s built theme into a
          fresh builder — colors, scales, breakpoints, and color modes all carry
          over. Chain <code>.addColors()</code> or <code>.addScale()</code> to
          augment. Same-name scales merge (union of keys). The test-ds
          components below were authored against their own reference theme but
          render here because the showcase theme provides compatible token
          paths.
        </Intro>
        <SizeRow>
          <TestDsButton variant="primary" px={16} py={8}>
            Primary
          </TestDsButton>
          <TestDsButton variant="secondary" px={16} py={8}>
            Secondary
          </TestDsButton>
          <TestDsButton variant="ghost" px={16} py={8}>
            Ghost
          </TestDsButton>
        </SizeRow>
        <TestDsCard>
          Card from @animus-ui/test-ds — authored against a different reference
          theme, rendered against the consumer&apos;s extended theme.
        </TestDsCard>
        <CodeSection>
          <SyntaxBlock language="tsx">{THEME_COMPOSE_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2" id="extension-chains">
          Extension Chains
        </Heading>
        <Intro>
          <code>.extend()</code> opens a new builder chain that inherits the
          parent&apos;s styles, variants, states, and system config.{' '}
          <code>ButtonLink</code> swaps the element to <code>&lt;a&gt;</code>.{' '}
          <code>ButtonDisplay</code> layers additional styles. Both inherit all
          three variant axes (color, kind, size). Extraction emits parent and
          child to the same <code>@layer</code>, source-ordered — child styles
          predictably override.
        </Intro>
        <SizeRow>
          <Button color="primary" kind="fill" size="md">
            Button
          </Button>
          <ButtonLink
            color="primary"
            kind="fill"
            size="md"
            href="#extension-chains"
          >
            ButtonLink
          </ButtonLink>
          <ButtonDisplay color="primary" kind="fill" size="md">
            ButtonDisplay
          </ButtonDisplay>
        </SizeRow>
        <SizeRow>
          <Button color="secondary" kind="outline" size="sm">
            Base
          </Button>
          <ButtonLink
            color="secondary"
            kind="outline"
            size="sm"
            href="#extension-chains"
          >
            Link
          </ButtonLink>
          <ButtonDisplay color="secondary" kind="outline" size="sm">
            Display
          </ButtonDisplay>
        </SizeRow>
        <CodeSection>
          <SyntaxBlock language="tsx">{EXTEND_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2" id="custom-prop-transforms">
          Custom Prop Transforms
        </Heading>
        <Intro>
          Inline transform functions in <code>.props()</code> — the Rust
          extractor captures the function body from the AST and emits it
          directly in the replacement JS. No named registry, no createTransform
          wrapper.
        </Intro>
        <SizeRow>
          <Swatch sizing={48} depth="sm" bg="fire.600" p={8} />
          <Swatch sizing={64} depth="md" bg="fire.500" p={12} />
          <Swatch sizing={96} depth="lg" bg="fire.400" p={16} />
          <Swatch sizing={0.5} depth="lg" bg="scheme.500" p={24}>
            <Intro>50% width via fractional transform</Intro>
          </Swatch>
        </SizeRow>
      </Section>

      <Section>
        <Heading as="h2" id="selector-aliases">
          Selector Aliases
        </Heading>
        <Intro>
          Typed pseudo-state and pseudo-element targeting via <code>_</code>
          -prefixed keys. Aliases expand to CSS selectors at extraction time and
          emit in the same <code>@layer</code> as their chain position.{' '}
          <code>_before</code> and <code>_after</code> auto-default{' '}
          <code>content: &quot;&quot;</code>.
        </Intro>
        <SizeRow>
          <AliasCard tabIndex={0}>
            <AliasTag status="active">active</AliasTag>
            Hover me
          </AliasCard>
          <AliasCard tabIndex={0}>
            <AliasTag status="warning">warning</AliasTag>
            Tab to focus
          </AliasCard>
          <AliasCard tabIndex={0} aria-disabled="true">
            <AliasTag status="error">error</AliasTag>
            Disabled
          </AliasCard>
        </SizeRow>
        <CodeSection>
          <SyntaxBlock language="tsx">{ALIAS_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <ComposeSection />

      <Section>
        <Heading as="h2" id="portal-composition">
          Portal Composition
        </Heading>
        <Intro>
          When a composed slot renders through a portal (outside Root&apos;s DOM
          subtree), CSS descendant selectors can&apos;t reach it. Pass{' '}
          <code>context: true</code> to compose() — shared variant props
          propagate via React context, crossing the portal boundary. The
          extraction pipeline still emits CSS rules for in-DOM children and
          automatically injects <code>&apos;use client&apos;</code> when needed.
        </Intro>

        <SizeRow>
          <Tooltip content="Small tooltip — sm size" size="sm">
            <Button color="primary" kind="outline" size="sm">
              Hover (sm)
            </Button>
          </Tooltip>
          <Tooltip
            content="Large tooltip — lg size with more padding"
            size="lg"
          >
            <Button color="primary" kind="outline" size="sm">
              Hover (lg)
            </Button>
          </Tooltip>
          <Tooltip
            content="Size inherited via context through portal"
            size="lg"
          >
            <Button color="secondary" kind="subtle" size="sm">
              Portal proof
            </Button>
          </Tooltip>
        </SizeRow>

        <CodeSection>
          <SyntaxBlock language="tsx">{TOOLTIP_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2" id="as-child-polymorphism">
          asChild Polymorphism
        </Heading>
        <Intro>
          <code>asChild</code> delegates rendering to the child element. The
          parent resolves its className, then merges it onto the child via{' '}
          <code>cloneElement</code>. The child keeps its own props and types —
          no type unsoundness, no lost autocomplete.
        </Intro>

        <SizeRow>
          <Button color="primary" kind="fill" size="sm" asChild>
            <a href="#as-child-demo">Anchor with Button styles</a>
          </Button>
          <Button color="secondary" kind="outline" size="sm" asChild>
            {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
            <span role="link" tabIndex={0}>
              Span with Button styles
            </span>
          </Button>
          <Button color="success" kind="ghost" size="sm">
            Normal button (no asChild)
          </Button>
        </SizeRow>

        <CodeSection>
          <SyntaxBlock language="tsx">{AS_CHILD_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2" id="scheme-pattern">
          The Scheme Pattern
        </Heading>
        <Intro>
          The color variant is a palette factory. It rebinds weighted CSS
          variables — the component never knows which palette is active. Any
          component can adopt the same pattern.
        </Intro>
        <CodeSection>
          <SyntaxBlock language="tsx">{SCHEME_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>
    </PageWrapper>
  );
}
