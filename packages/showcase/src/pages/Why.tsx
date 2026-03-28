import { MarkdownContent } from '../components/docs/MarkdownContent';
import content from '../content/why.md?raw';

export default function Why() {
  return <MarkdownContent source={content} />;
}
