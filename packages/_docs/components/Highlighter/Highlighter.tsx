import { animus } from '@animus-ui/core';
import { Background, Box, useCurrentMode } from '@animus-ui/components';
import Highlight, { defaultProps } from 'prism-react-renderer';
import { theme } from './theme';
import { flow } from 'components/FlowLink';

const Backdrop = animus
  .styles({
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    backgroundSize: '300px 100px',
    animation: ` ${flow} 5s linear infinite`,
  })
  .variant({
    prop: 'tilt',
    defaultVariant: 'left',
    variants: {
      left: {
        transform: 'rotate(0.3deg)',
      },
      right: {
        transform: 'rotate(-0.3deg)',
      },
    },
  })
  .groups({ layout: true, positioning: true })
  .asComponent('div');

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
    <Box position="relative">
      <Backdrop position="absolute" inset={-2} zIndex={-1} />
      <Background bg="navy-800" mb={16} mt={24}>
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
    </Box>
  );
};
