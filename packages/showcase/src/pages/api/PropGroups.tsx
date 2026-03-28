import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/prop-groups.md?raw';

export default function PropGroups() {
  return <MarkdownContent source={content} />;
}
