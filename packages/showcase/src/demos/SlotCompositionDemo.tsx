import { useState } from 'react';

import { Button, Card, Heading, Prose, Row, Stack } from '../components';
import { ds } from '../ds';

const CardGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    alignItems: 'start',
  })
  .asElement('div');

export function SlotCompositionDemo() {
  const [density, setDensity] = useState<'compact' | 'comfortable'>(
    'comfortable'
  );

  return (
    <Stack gap={16}>
      <Heading as="h3">Live demo</Heading>

      <Prose>Toggle density — one prop on Root, every slot responds.</Prose>

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
    </Stack>
  );
}
