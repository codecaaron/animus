import { animus } from '@animus-ui/core';

import { flow } from '../../animations/flow';

export const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 30,
    m: 0,
    lineHeight: 'initial',
    fontFamily: 'logo',
    letterSpacing: '2px',
    gradient: 'flowX',
    backgroundSize: '300px 100px',
    animation: ` ${flow} 5s linear infinite`,
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
    transition: 'text',
  })
  .states({
    link: {
      animation: 'none',
      '&:hover': {
        textShadow: 'logo-hover',
        animation: ` ${flow} 5s linear infinite`,
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
      scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
    },
  })
  .asComponent('h1');
