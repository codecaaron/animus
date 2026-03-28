import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/create-system.md?raw';

export default function CreateSystem() {
  return <MarkdownContent source={content} />;
}
