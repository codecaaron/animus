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
        {/*
          External keyframe-collection witness (ani-015-root-issues): KitPulse
          animates with `kitMotion.pulse` from the test-ds package ENTRY —
          rendered beside the app-local Pulse/Fade siblings so usage
          reconciliation keeps all three animation references.
        */}
        <KitPulse>Kit Pulse</KitPulse>
      </Stack>

      {/*
        Binding-backed vs inline variant-map siblings (ani-015-root-issues):
        every option of BOTH components renders so usage reconciliation keeps
        the full option set on each — assertVariantDeclarationParity compares
        the two per class.
      */}
      <Stack direction="row" gap={8}>
        <KitSized size="sm">Kit sm</KitSized>
        <KitSized size="md">Kit md</KitSized>
        <KitSized size="lg">Kit lg</KitSized>
        <InlineSized size="sm">Inline sm</InlineSized>
        <InlineSized size="md">Inline md</InlineSized>
        <InlineSized size="lg">Inline lg</InlineSized>
      </Stack>

      {/*
        Ancestor-subject witnesses (ani-015-root-issues): the wrapper carries
        BOTH ancestor contexts — `data-active="true"` for the raw ancestor
        keys (app ActiveItem + adjacent-sibling `& + &` pair) and the `group`
        class for the kit GroupItem's registered `_groupHover` alias
        (`.group:hover &`). GroupItem's `_dark` alias matches the
        `[data-color-mode]` attribute the appearance bootstrap sets on :root.
      */}
      <div className="group" data-active="true">
        <ActiveItem>Active A</ActiveItem>
        <ActiveItem>Active B</ActiveItem>
        <GroupItem>Kit group item</GroupItem>
      </div>
    </Stack>
  );
}
