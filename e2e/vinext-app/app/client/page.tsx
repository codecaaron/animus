'use client';

import { useState } from 'react';

import { Button, Panel, Stack } from '../../src/components';

const intents = ['primary', 'danger', 'ghost'] as const;

export default function ClientPage() {
  const [index, setIndex] = useState(0);
  const intent = intents[index % intents.length];

  return (
    <Stack p={32} gap={16}>
      <h1>Vinext client boundary canary</h1>
      <Button intent={intent} onClick={() => setIndex((value) => value + 1)}>
        Intent: {intent}
      </Button>
      <Panel tone={intent === 'danger' ? 'danger' : 'neutral'}>
        Hydrated interaction count: {index}
      </Panel>
    </Stack>
  );
}
