import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/concepts/design-tokens.md?raw';

export default function DesignTokens() {
  return <MarkdownContent source={content} />;
}
