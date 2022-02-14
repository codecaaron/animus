import { animus } from '@animus-ui/core';
import { keyframes } from '@emotion/react';

export const slide = keyframes`
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
    gradient: 'flowX',
    backgroundSize: '300px 100px',
    animation: ` ${slide} 5s linear infinite`,
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
    transition: 'text',
  })
  .states({
    link: {
      '&:hover': {
        textShadow: 'logo-hover',
      },
      '&:active': {
        textShadow: 'link-pressed',
      },
    },
  })
  .groups({ typography: true })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { sm: 24, md: 34, lg: 64, xxl: 128 },
    },
  })
  .asComponent('h1');
