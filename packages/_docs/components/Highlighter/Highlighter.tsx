import { Box } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import Highlight, { defaultProps } from 'prism-react-renderer';

import { theme } from './theme';

const Pre = animus
  .styles({
    fontFamily: 'monospace',
    p: 24,
    position: 'relative',
  })
  .groups({ color: true, space: true, borders: true })
  .asComponent('pre');

export const Line = animus.styles({ display: 'table-row' }).asComponent('div');

export const Token = animus.styles({ transition: 'text' }).asComponent('span');

export function Highlighter({ children }) {
  return (
    <Box bg="background-current" my={24}>
      <Highlight
        {...defaultProps}
        theme={theme}
        code={children.props.children.trim()}
        language={children.props.className.replace('language-', '')}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <Pre
            className={className}
            bg="syntax-background"
            m={0}
            style={{
              ...style,
            }}
          >
            {tokens.map((line, i) => (
              <Line {...getLineProps({ line, key: i })}>
                {line.map((token, key) => (
                  // eslint-disable-next-line react/jsx-key
                  <Token {...getTokenProps({ token, key })} />
                ))}
              </Line>
            ))}
          </Pre>
        )}
      </Highlight>
    </Box>
  );
}
