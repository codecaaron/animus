import {
  Button as PackageButton,
  Card as PackageCard,
} from '@animus-ui/test-ds';

import { Button, Panel, Stack } from '../src/components';

export default function Home() {
  return (
    <Stack p={32} gap={24}>
      <h1>Vinext RSC canary</h1>
      <p>App Router server component rendered through workerd.</p>
      <Stack direction="row" gap={8}>
        <Button intent="primary" size="small">
          Primary
        </Button>
        <Button intent="danger" size="large">
          Danger
        </Button>
      </Stack>
      <Panel tone="neutral">
        <PackageButton variant="primary" px={24} py={8}>
          Package component
        </PackageButton>
        <PackageCard>External design-system package</PackageCard>
      </Panel>
    </Stack>
  );
}
