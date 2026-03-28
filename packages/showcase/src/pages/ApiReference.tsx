import { MarkdownContent } from '../components/docs/MarkdownContent';
import content from '../content/api-reference.md?raw';

export default function ApiReference() {
  return <MarkdownContent source={content} />;
}
