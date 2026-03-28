import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/vite-plugin.md?raw';

export default function VitePlugin() {
  return <MarkdownContent source={content} />;
}
