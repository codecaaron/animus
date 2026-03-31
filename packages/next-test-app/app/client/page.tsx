'use client';

import { useState } from 'react';

import { Badge, Button, Card, Stack } from '../../src/components';

const sizes = ['small', 'medium', 'large'] as const;
const intents = ['primary', 'secondary', 'danger', 'ghost'] as const;

export default function ClientPage() {
  const [sizeIndex, setSizeIndex] = useState(0);
  const [intentIndex, setIntentIndex] = useState(0);
  const currentSize = sizes[sizeIndex % sizes.length];
  const currentIntent = intents[intentIndex % intents.length];

  return (
    <Stack p={32} gap={24}>
      <Stack gap={4}>
        <h2>Interactive Client Page</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          Variant toggling via useState — proves extracted CSS covers all states
        </p>
      </Stack>

      <Stack direction="row" gap={8} alignItems="center">
        <Button
          size={currentSize}
          intent={currentIntent}
          onClick={() => setSizeIndex((i) => i + 1)}
        >
          Size: {currentSize}
        </Button>
        <Button
          size="medium"
          intent="ghost"
          onClick={() => setIntentIndex((i) => i + 1)}
        >
          Intent: {currentIntent}
        </Button>
      </Stack>

      <Card elevation="raised" sizing="100%">
        <Stack gap={8}>
          <Badge
            size={currentSize === 'large' ? 'large' : 'small'}
            intent="info"
          >
            Dynamic badge
          </Badge>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Card with dynamic badge size tied to button state
          </p>
        </Stack>
      </Card>
    </Stack>
  );
}
