import { Stack } from '../components';
import { MarkdownContent } from '../components/docs/MarkdownContent';
import content from '../content/concepts.md?raw';
import { SlotCompositionDemo } from '../demos/SlotCompositionDemo';

export default function Concepts() {
  return (
    <Stack gap={64}>
      <MarkdownContent source={content} />
      <SlotCompositionDemo />
    </Stack>
  );
}
