import { Card as TestDsCard } from '@animus-ui/test-ds';

import {
  Box,
  Button,
  Card,
  Fade,
  Family,
  Pulse,
  Stack,
  StackItem,
} from './components';
import { ds } from './ds';

const Heading = ds.styles({ fontSize: 24, fontWeight: 700 }).asElement('h1');
const Subheading = ds.styles({ color: 'text.muted' }).asElement('p');

export function App() {
  return (
    <Stack p={32} gap={24}>
      <Stack gap={8}>
        <Heading>Vite Test App</Heading>
        <Subheading>Extraction proof for vite-plugin</Subheading>
      </Stack>

      <Stack direction="row" gap={8}>
        <Button size="small" intent="primary">
          Small Primary
        </Button>
        <Button size="medium" intent="secondary">
          Medium Secondary
        </Button>
        <Button size="large" intent="danger">
          Large Danger
        </Button>
      </Stack>

      <Stack direction="row" gap={16}>
        <Card>
          <span>Card A</span>
        </Card>
        <Card>
          <strong>Card B</strong>
        </Card>
      </Stack>

      <Stack gap={8}>
        <StackItem emphasis="muted">Muted item (extension chain)</StackItem>
        <StackItem emphasis="strong">Strong item (extension chain)</StackItem>
      </Stack>

      <Family.Root density="comfortable">
        <Box p={4}>
          <Family.Child intent="secondary">Composed family child</Family.Child>
        </Box>
      </Family.Root>

      {/*
        Merged-config extraction witness (openspec: first-class-extension,
        NS-1 / rust-system-loader › "Merged configuration is the extraction
        authority"): `top` and `zIndex` belong to the `positioning` group,
        which ONLY test-ds registers — src/ds.ts deliberately does not
        re-register it, so these usages emit CSS solely because
        `.extend(testDs)` merges the kit's registries into the extracting
        config. `top` additionally proves the kit's `size` transform survives
        the snapshot merge (12 → 12px). Pinned by scripts/assert-build.ts.
      */}
      <Box p={16} gap={8} top={12} zIndex={10}>
        <TestDsCard>Cross-package test-ds Card</TestDsCard>
      </Box>

      <Stack direction="row" gap={8}>
        <Pulse>Pulse</Pulse>
        <Fade>Fade In</Fade>
      </Stack>
    </Stack>
  );
}
