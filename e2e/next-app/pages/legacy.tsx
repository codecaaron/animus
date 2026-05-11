import { Button as TestDsButton, Card as TestDsCard } from '@animus-ui/test-ds';

import { Badge, Button, Card, Family, Stack } from '../src/components';

export default function LegacyPage() {
  return (
    <Stack p={32} gap={24}>
      <Stack gap={4}>
        <h2>Pages Router</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          Same components, SSR rendering model
        </p>
      </Stack>

      <Stack direction="row" gap={8}>
        <Button size="medium" intent="primary">
          Primary
        </Button>
        <Button size="large" intent="secondary">
          Secondary
        </Button>
        <Button size="small" intent="ghost">
          Ghost
        </Button>
      </Stack>

      <Card elevation="raised" sizing="100%">
        <Stack gap={8}>
          <Badge size="small" intent="danger">
            Pages Router
          </Badge>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Proves extraction works in traditional SSR
          </p>
        </Stack>
      </Card>

      <Stack gap={16}>
        <h3>External Package Components</h3>
        <Stack direction="row" gap={8}>
          <TestDsButton variant="primary" px={48} py={8}>
            Primary
          </TestDsButton>
          <TestDsButton variant="secondary" px={24} py={8}>
            Secondary
          </TestDsButton>
        </Stack>
        <TestDsCard>External card from test-ds</TestDsCard>
      </Stack>

      <Family.Root density="compact">
        <Family.Child density="compact" intent="primary">
          Child A
        </Family.Child>
        <Family.Child density="compact" intent="secondary">
          Child B
        </Family.Child>
      </Family.Root>
    </Stack>
  );
}
