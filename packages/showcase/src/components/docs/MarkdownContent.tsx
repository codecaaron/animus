import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ds } from '../../ds';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';
import { TableContainer, Td, Th } from '../surfaces/Table';
import { InlineCode } from '../typography/InlineCode';
import { Prose } from '../typography/Prose';
import { Strong } from '../typography/Strong';
import { Heading } from './Heading';

const ContentWrapper = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  })
  .asElement('div');

const Anchor = ds
  .styles({
    color: 'primary',
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  })
  .asElement('a');

const BlockquoteWrapper = ds
  .styles({
    borderLeft: 3,
    borderLeftColor: 'primary',
    pl: 16,
    my: 16,
  })
  .asElement('blockquote');

const ListWrapper = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'relaxed',
    color: 'text-muted',
    pl: 24,
    m: 0,
    mb: 16,
  })
  .system({ space: true, text: true })
  .asElement('ul');

const OrderedListWrapper = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'relaxed',
    color: 'text-muted',
    pl: 24,
    m: 0,
    mb: 16,
    listStyle: 'decimal',
    '& li::marker': {
      color: 'primary',
    },
  })
  .system({ space: true, text: true })
  .asElement('ol');

const ListItemStyled = ds
  .styles({
    mb: 8,
    position: 'relative',
  })
  .asElement('li');

const CodeBlockWrapper = ds
  .styles({
    my: 24,
  })
  .asElement('div');

const Divider = ds
  .styles({
    border: 'none',
    borderTop: 1,
    borderTopColor: 'border',
    my: 32,
  })
  .asElement('hr');

const componentMap = {
  h1: ({ children }: { children?: ReactNode }) => (
    <Heading as="h1">{children}</Heading>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <Heading as="h2">{children}</Heading>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <Heading as="h3">{children}</Heading>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <Heading as="h4">{children}</Heading>
  ),
  p: ({ children }: { children?: ReactNode }) => <Prose>{children}</Prose>,
  strong: ({ children }: { children?: ReactNode }) => (
    <Strong>{children}</Strong>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <Anchor href={href}>{children}</Anchor>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <BlockquoteWrapper>{children}</BlockquoteWrapper>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ListWrapper>{children}</ListWrapper>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <OrderedListWrapper as="ol">{children}</OrderedListWrapper>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <ListItemStyled>{children}</ListItemStyled>
  ),
  hr: () => <Divider />,
  table: ({ children }: { children?: ReactNode }) => (
    <TableContainer>{children}</TableContainer>
  ),
  th: ({ children }: { children?: ReactNode }) => <Th>{children}</Th>,
  td: ({ children }: { children?: ReactNode }) => <Td>{children}</Td>,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: ReactNode;
  }) => {
    const langMatch = /language-(\w+)/.exec(className || '');
    if (langMatch) {
      return (
        <CodeBlockWrapper>
          <SyntaxBlock
            language={langMatch[1] as 'tsx' | 'css' | 'typescript' | 'sh'}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxBlock>
        </CodeBlockWrapper>
      );
    }
    return <InlineCode>{children}</InlineCode>;
  },
};

export function MarkdownContent({ source }: { source: string }) {
  return (
    <ContentWrapper>
      <Markdown remarkPlugins={[remarkGfm]} components={componentMap}>
        {source}
      </Markdown>
    </ContentWrapper>
  );
}
