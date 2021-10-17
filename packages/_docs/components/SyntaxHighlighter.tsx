import { Box, Text } from '@animus/elements';
import { animus } from '@animus/props';
import { Background } from '@animus/provider';
import Highlight, { PrismTheme, defaultProps } from 'prism-react-renderer';

const Pre = animus
  .styles({ p: 24, bg: 'background-emphasized', position: 'relative' })
  .asComponent('pre');

export const Line = animus.styles({ display: 'table-row' }).asComponent('div');

const theme: PrismTheme = {
  plain: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    color: '#10162F',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata', 'punctuation'],
      style: {
        color: '#585C6D',
      },
    },
    {
      types: ['namespace'],
      style: {
        opacity: 0.7,
      },
    },
    {
      types: ['tag', 'operator', 'number'],
      style: {
        color: '#CCA900',
      },
    },
    {
      types: ['property', 'function'],
      style: {
        color: '#93264F',
      },
    },
    {
      types: ['tag-id', 'selector', 'atrule-id'],
      style: {
        color: '#93264F',
      },
    },
    {
      types: ['attr-name'],
      style: {
        color: '#93264F',
      },
    },
    {
      types: ['keyword'],
      style: {
        color: '#3388FF',
      },
    },
    {
      types: [
        'boolean',
        'string',
        'entity',
        'url',
        'attr-value',
        'control',
        'directive',
        'unit',
        'statement',
        'regex',
        'at-rule',
        'placeholder',
        'variable',
      ],
      style: {
        color: '#3388FF',
      },
    },
    {
      types: ['deleted'],
      style: {
        textDecorationLine: 'line-through',
      },
    },
    {
      types: ['inserted'],
      style: {
        textDecorationLine: 'underline',
      },
    },
    {
      types: ['italic'],
      style: {
        fontStyle: 'italic',
      },
    },
    {
      types: ['important', 'bold'],
      style: {
        fontWeight: 'bold',
      },
    },
    {
      types: ['important'],
      style: {
        color: '#3388FF',
      },
    },
  ],
};

export const Highlighter = ({ children }) => {
  return (
    <Highlight
      {...defaultProps}
      theme={theme}
      code={children.props.children.trim()}
      language={children.props.className.replace('language-', '')}
    >
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <Pre
          className={className}
          position="relative"
          style={{
            ...style,
          }}
        >
          <Background
            position="absolute"
            top="0"
            right="2rem"
            p={4}
            px={8}
            bg="pink-500"
          >
            <Text fontFamily="title" fontWeight={700}>
              {children.props.className.replace('language-', '')}
            </Text>
          </Background>
          {tokens.map((line, i) => (
            <Line {...getLineProps({ line, key: i })}>
              {line.map((token, key) => (
                // eslint-disable-next-line react/jsx-key
                <span {...getTokenProps({ token, key })} />
              ))}
            </Line>
          ))}
        </Pre>
      )}
    </Highlight>
  );
};
