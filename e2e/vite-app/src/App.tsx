import { Card as TestDsCard, GroupItem } from '@animus-ui/test-ds';

import {
  ActiveItem,
  Box,
  Button,
  Card,
  Fade,
  Family,
  InlineSized,
  KitPulse,
  KitSized,
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

      {/* `top` and `zIndex` resolve only through the positioning group that
          test-ds registers and src/ds.ts does not. */}
      <Box p={16} gap={8} top={12} zIndex={10}>
        <TestDsCard>Cross-package test-ds Card</TestDsCard>
      </Box>

      <Stack direction="row" gap={8}>
        <Pulse>Pulse</Pulse>
        <Fade>Fade In</Fade>
        {/* KitPulse renders beside the app-local Pulse and Fade so usage
            reconciliation keeps all three animation references. */}
        <KitPulse>Kit Pulse</KitPulse>
      </Stack>

      {/* Every option of both components must render, or usage reconciliation
          prunes it before assertVariantDeclarationParity compares them. */}
      <Stack direction="row" gap={8}>
        <KitSized size="sm">Kit sm</KitSized>
        <KitSized size="md">Kit md</KitSized>
        <KitSized size="lg">Kit lg</KitSized>
        <InlineSized size="sm">Inline sm</InlineSized>
        <InlineSized size="md">Inline md</InlineSized>
        <InlineSized size="lg">Inline lg</InlineSized>
      </Stack>

      {/* The wrapper supplies both ancestor contexts: `data-active` for
          ActiveItem and the `group` class for GroupItem's `_groupHover`. */}
      <div className="group" data-active="true">
        <ActiveItem>Active A</ActiveItem>
        <ActiveItem>Active B</ActiveItem>
        <GroupItem>Kit group item</GroupItem>
      </div>
    </Stack>
  );
}
