import { Button as TestDsButton, Card as TestDsCard } from '@animus-ui/test-ds';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../components/docs/Button';
import { Heading } from '../components/docs/Heading';
import { SyntaxBlock } from '../components/surfaces/SyntaxBlock';
import { ds } from '../ds';

const PageWrapper = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 48,
    pb: 96,
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
    maxWidth: '40rem',
  })
  .asElement('p');

const CodeSection = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: '40rem',
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
        <Heading as="h2">Component Matrix</Heading>
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
        <Heading as="h2">Usage</Heading>
        <CodeSection>
          <SyntaxBlock language="tsx">{USAGE_CODE}</SyntaxBlock>
        </CodeSection>
      </Section>

      <Section>
        <Heading as="h2">External Package Components</Heading>
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
        <Heading as="h2">Custom Prop Transforms</Heading>
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
        <Heading as="h2">The Scheme Pattern</Heading>
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
