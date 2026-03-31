'use client';

import { useState } from 'react';

import { Box, Button, Family } from '../../src/components';

const sizes = ['small', 'medium', 'large'] as const;

export default function ClientPage() {
  const [sizeIndex, setSizeIndex] = useState(0);
  const currentSize = sizes[sizeIndex % sizes.length];

  return (
    <Box p={16}>
      <Button
        size={currentSize}
        intent="primary"
        onClick={() => setSizeIndex((i) => i + 1)}
      >
        Size: {currentSize}
      </Button>
      <Family.Root size="large">
        <Family.Child size="large" intent="primary">
          Child A
        </Family.Child>
        <Family.Child size="large" intent="secondary">
          Child B
        </Family.Child>
      </Family.Root>
    </Box>
  );
}
