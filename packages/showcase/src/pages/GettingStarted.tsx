import { MarkdownContent } from '../components/docs/MarkdownContent';
import content from '../content/getting-started.md?raw';

export default function GettingStarted() {
  return <MarkdownContent source={content} />;
}
