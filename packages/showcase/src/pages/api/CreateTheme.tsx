import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/create-theme.md?raw';

export default function CreateTheme() {
  return <MarkdownContent source={content} />;
}
