import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/create-transform.md?raw';

export default function CreateTransform() {
  return <MarkdownContent source={content} />;
}
