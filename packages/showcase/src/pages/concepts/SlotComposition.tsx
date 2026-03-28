import { Stack } from '../../components';
import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/concepts/slot-composition.md?raw';
import { SlotCompositionDemo } from '../../demos/SlotCompositionDemo';

export default function SlotComposition() {
  return (
    <Stack gap={32}>
      <MarkdownContent source={content} />
      <SlotCompositionDemo />
    </Stack>
  );
}
