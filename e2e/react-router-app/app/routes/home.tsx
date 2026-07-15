import {
  Button as PackageButton,
  Card as PackageCard,
} from '@animus-ui/test-ds';

import { Button, Panel, Stack } from '../../src/components';

export function loader() {
  return { runtime: 'cloudflare-worker-ssr' };
}

export default function Home({
  loaderData,
}: {
  loaderData: { runtime: string };
}) {
  return (
    <Stack p={32} gap={24}>
      <h1>React Router v8 SSR canary</h1>
      <p>Runtime: {loaderData.runtime}</p>
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
        <PackageCard>React Router package extraction</PackageCard>
      </Panel>
    </Stack>
  );
}
