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

      <Family.Root size="small">
        <Family.Child size="small" intent="primary">
          Child A
        </Family.Child>
        <Family.Child size="small" intent="secondary">
          Child B
        </Family.Child>
      </Family.Root>
    </Stack>
  );
}
