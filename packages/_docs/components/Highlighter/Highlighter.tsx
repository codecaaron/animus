import { Box } from '@syzygos/components';
import { animus } from '@syzygos/core';
import Highlight, { defaultProps } from 'prism-react-renderer';

import { usePrismTheme } from './usePrismTheme';

const Pre = animus
  .styles({
    fontFamily: 'monospace',
    p: 24,
    fontSize: { _: 14, xs: 16 },
    position: 'relative',
  })
  .groups({ color: true, space: true, borders: true })
  .asElement('pre');

export const Line = animus.styles({ display: 'table-row' }).asElement('div');

export const Token = animus.styles({ transition: 'text' }).asElement('span');

export function Highlighter({ children }) {
  const theme = usePrismTheme();
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
              // eslint-disable-next-line react/jsx-key
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
