import { useState } from 'react';

import {
  Button,
  Card,
  Heading,
  InlineCode,
  Mono,
  Prose,
  Row,
  Stack,
  SyntaxBlock,
} from '../components';
import { ds } from '../ds';

const CardGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    alignItems: 'start',
  })
  .asElement('div');

const composeSlotDefinitions = `\
// Each slot is an independent component with its own cascade layers.
// density exists on every slot — compose() enforces matching value sets.

const CardRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'mono',
    color: 'text',
  })
  .variant({
    prop: 'density',
    variants: {
      compact:     { p: 12, gap: 4 },
      comfortable: { p: 24, gap: 12 },
    },
  })
  .variant({
    prop: 'variant',
    variants: {
      elevated: { bg: 'surface', border: 1, borderColor: 'border', boxShadow: 'glow-accent' },
      outlined: { bg: 'transparent', border: 1, borderColor: 'border' },
      ghost:    { bg: 'transparent', border: 1, borderColor: 'transparent' },
    },
  })
  .asElement('article');

const CardHeader = ds
  .styles({ fontWeight: 500, color: 'text' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { fontSize: 13, pb: 4 },
      comfortable: { fontSize: 16, pb: 8 },
    },
  })
  .asElement('header');

const CardBody = ds
  .styles({ color: 'text-muted', lineHeight: 'relaxed' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { fontSize: 12 },
      comfortable: { fontSize: 14 },
    },
  })
  .asElement('div');

const CardFooter = ds
  .styles({ display: 'flex', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'border' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { gap: 6, pt: 8, mt: 4, fontSize: 12 },
      comfortable: { gap: 12, pt: 16, mt: 8, fontSize: 13 },
    },
  })
  .asElement('footer');`;

const composeCallExample = `\
import { compose } from '@animus-ui/system';

// Enforce: density must exist on ALL slots with matching values.
// Wire:    Root provides density via context. Children consume it.
// Seal:    Output components have no .extend() — the chain is closed.

const Card = compose({
  Root: CardRoot,
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
}, { shared: ['density'] as const });`;

const composeUsageExample = `\
// One prop on Root — every slot responds.
<Card.Root density="compact" variant="elevated">
  <Card.Header>System Status</Card.Header>
  <Card.Body>All services operational.</Card.Body>
  <Card.Footer>
    <Button size="sm" kind="ghost">Details</Button>
  </Card.Footer>
</Card.Root>`;

export function SlotCompositionDemo() {
  const [density, setDensity] = useState<'compact' | 'comfortable'>(
    'comfortable'
  );

  return (
    <Stack gap={16}>
      <Heading as="h2">Slot Composition</Heading>

      <Prose fontSize={16} lineHeight="relaxed">
        Multi-part components — cards, accordions, form fields — need
        coordinated styling across named sub-elements. Each slot is an
        independent Animus component with its own cascade layers.{' '}
        <InlineCode>compose()</InlineCode> takes these independent slots and
        produces a sealed component family with shared variant propagation via
        React context.
      </Prose>

      <Prose fontSize={16} lineHeight="relaxed">
        The utility performs three operations: <Mono>Enforce</Mono> — TypeScript
        verifies that every shared variant key exists on all slots with matching
        value sets. Compile error on mismatch. <Mono>Wire</Mono> — Root becomes
        a context provider for shared variant values. Child slots consume them
        automatically. Direct props on children override context.{' '}
        <Mono>Seal</Mono> — output components are plain{' '}
        <InlineCode>ForwardRefExoticComponent</InlineCode> with no{' '}
        <InlineCode>.extend()</InlineCode>. The builder chain is closed at
        composition time.
      </Prose>

      <Heading as="h3">Define slots independently</Heading>

      <Prose fontSize={16} lineHeight="relaxed">
        Each slot is a normal builder chain. The{' '}
        <InlineCode>density</InlineCode> variant exists on every slot — compact
        tightens spacing and font sizes, comfortable opens them up. The{' '}
        <InlineCode>variant</InlineCode> prop (elevated, outlined, ghost) exists
        only on Root.
      </Prose>

      <SyntaxBlock language="tsx">{composeSlotDefinitions}</SyntaxBlock>

      <Heading as="h3">Compose the family</Heading>

      <SyntaxBlock language="tsx">{composeCallExample}</SyntaxBlock>

      <Heading as="h3">Live demo</Heading>

      <Prose fontSize={16} lineHeight="relaxed">
        Toggle density — one prop on Root, every slot responds. The{' '}
        <InlineCode>variant</InlineCode> prop stays isolated on Root.
      </Prose>

      <Row gap={8}>
        <Button
          size="sm"
          kind={density === 'compact' ? 'fill' : 'ghost'}
          onClick={() => setDensity('compact')}
        >
          compact
        </Button>
        <Button
          size="sm"
          kind={density === 'comfortable' ? 'fill' : 'ghost'}
          onClick={() => setDensity('comfortable')}
        >
          comfortable
        </Button>
      </Row>

      <CardGrid>
        <Card.Root density={density} variant="elevated">
          <Card.Header>Elevated</Card.Header>
          <Card.Body>
            Surface background with glow shadow. The default visual treatment.
          </Card.Body>
          <Card.Footer>
            <Button size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density={density} variant="outlined">
          <Card.Header>Outlined</Card.Header>
          <Card.Body>
            Border only. Transparent background lets the page show through.
          </Card.Body>
          <Card.Footer>
            <Button size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>

        <Card.Root density={density} variant="ghost">
          <Card.Header>Ghost</Card.Header>
          <Card.Body>
            No border, no fill. Minimal presence for secondary content.
          </Card.Body>
          <Card.Footer>
            <Button size="sm" kind="ghost">
              Action
            </Button>
          </Card.Footer>
        </Card.Root>
      </CardGrid>

      <Heading as="h3">Consumer usage</Heading>

      <SyntaxBlock language="tsx">{composeUsageExample}</SyntaxBlock>
    </Stack>
  );
}
