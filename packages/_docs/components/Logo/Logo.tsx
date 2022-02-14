import { animus } from '@animus-ui/core';
import { keyframes } from '@emotion/react';

const slide = keyframes`
  	0% {
    background-size: 300px 100px;
		background-position: 0% 50%;
	}
	100% {
		background-position: 300px 50%;
    background-size: 300px 100px;
	}
`;

export const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 30,
    m: 0,
    fontFamily: 'title',
    letterSpacing: '2px',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors['pink-600']} 0%, ${colors['purple-600']} 50%, ${colors['pink-600']} 100%)`,
    backgroundSize: '300px 100px',
    animation: ` ${slide} 5s linear infinite`,
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  })
  .groups({ typography: true })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { sm: 24, md: 34, lg: 64, xxl: 128 },
      transform: (val: number, _, props) => ({
        fontSize: val,
        textShadow:
          val > 34
            ? `8px -8px ${props.theme.colors.text}`
            : `4px -4px ${props.theme.colors.text}`,
      }),
    },
  })
  .asComponent('h1');
