import { animus } from '@animus/props';
import Highlight, { defaultProps } from 'prism-react-renderer';
import { theme } from './theme';

const Pre = animus
  .styles({
    p: 24,
    border: 1,
    borderColor: 'modifier-darken-100',
    bg: 'background-emphasized',
    position: 'relative',
  })
  .asComponent('pre');

export const Line = animus.styles({ display: 'table-row' }).asComponent('div');

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
