import { animus } from '@animus-ui/core';
import { Background, useCurrentMode } from '@animus-ui/components';
import Highlight, { defaultProps } from 'prism-react-renderer';
import { theme } from './theme';

const Pre = animus
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    border: 1,
    p: 24,
    borderColor: 'modifier-darken-100',
    bg: 'background-emphasized',
    position: 'relative',
  })
  .groups({ color: true, space: true })
  .asComponent('pre');

export const Line = animus.styles({ display: 'table-row' }).asComponent('div');

export const Highlighter = ({ children }) => {
  const mode = useCurrentMode();
  return (
    <Background bg="navy-800" mb={16}>
      <Highlight
        {...defaultProps}
        theme={theme}
        code={children.props.children.trim()}
        language={children.props.className.replace('language-', '')}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <Pre
            className={className}
            bg={mode === 'dark' ? 'modifier-darken-200' : 'transparent'}
            m={0}
            style={{
              ...style,
            }}
          >
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
    </Background>
  );
};
