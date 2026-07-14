import { Button as PackageButton } from '@animus-ui/test-ds';

import { Button, Panel, Stack } from '../src/components';

export default function LegacyPage() {
  return (
    <Stack p={32} gap={24}>
      <h1>Vinext Pages Router canary</h1>
      <p>Traditional SSR route rendered by Vinext.</p>
      <Stack direction="row" gap={8}>
        <Button intent="ghost" size="medium">
          Ghost
        </Button>
        <PackageButton variant="secondary" px={24} py={8}>
          Package secondary
        </PackageButton>
      </Stack>
      <Panel tone="danger">Pages Router extraction evidence</Panel>
    </Stack>
  );
}
