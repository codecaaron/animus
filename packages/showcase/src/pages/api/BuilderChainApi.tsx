import { MarkdownContent } from '../../components/docs/MarkdownContent';
import content from '../../content/api/builder-chain.md?raw';

export default function BuilderChainApi() {
  return <MarkdownContent source={content} />;
}
