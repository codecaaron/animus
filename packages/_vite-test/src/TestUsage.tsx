import React from 'react';

import { Button, PrimaryButton } from './Button';
import { Card } from './Card';
import { CollisionButton } from './ExtendedButton';

// This file uses components but doesn't define any
// It should NOT be detected as a component file by reference traversal
export function TestPage() {
  return (
    <Card raised>
      <h1>Test Page</h1>
      <Button size="small">Regular Button</Button>
      <PrimaryButton>Primary Button</PrimaryButton>
      <CollisionButton>Collision Button</CollisionButton>
    </Card>
  );
}

// Also test non-JSX usage
export function TestNonJSX() {
  const button = Button({ children: 'Click me' });
  return button;
}
