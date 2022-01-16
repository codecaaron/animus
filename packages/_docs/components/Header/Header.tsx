import { animus } from '@animus-ui/core';
import { useColorModes, Link } from '@animus-ui/components';
import { useRouter } from 'next/dist/client/router';
import { useContext } from 'react';
import { ThemeControlContext } from '../AppProvider/AppWrapper';
import { navlinks } from './constants';
import { keyframes } from '@emotion/react';

const slide = keyframes`
  0% {
    background-position: -30rem;
  }

  100% {
    background-position: 0rem;  }
`;

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: '4rem',
    area: 'header',
    overflow: 'hidden',
    py: 4,
    pb: 8,
    px: 32,
    zIndex: 2,
  })
  .states({
    bordered: {
      '&::after': {
        position: 'absolute',
        content: '""',
        height: 4,
        bottom: 0,
        left: -32,
        right: -32,
        backgroundSize: 'calc(100% + 80rem)',
        backgroundImage:
          'repeating-linear-gradient(90deg, rgb(149 128 255 / 100%), rgb(255 128 191 / 100%), rgb(149 128 255 / 100%) 30rem)',
        backgroundRepeat: 'repeat-x',
        animation: ` ${slide} 2s linear infinite`,
      },
    },
  })
  .asComponent('div');

const HeaderSection = animus
  .styles({
    display: 'grid',
    gap: 32,
    flow: 'column',
    alignItems: 'center',
    flex: 1,
  })
  .variant({
    prop: 'direction',
    variants: {
      left: {},
      right: {
        justifyContent: 'end',
      },
    },
  })
  .asComponent('div');

const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 30,
    m: 0,
    background: ({ colors }) =>
      `linear-gradient(to right, ${colors.tertiary} 0%, ${colors.primary} 100%)`,
    fontFamily: 'title',
    backgroundClip: 'text',
    letterSpacing: '2px',
    textFillColor: 'transparent' as any,
    transition: '200ms ease-in',
    '&:hover': {
      textShadow:
        '0 0 8px rgb(255 128 191 / 25%), 0 0 8px rgb(149 128 255 / 25%)',
    },
  })
  .asComponent('h1');

const Button = animus
  .styles({
    borderRadius: 4,
    bg: 'transparent',
    boxShadow: 'none',

    fontSize: 14,
    fontWeight: 400,
    color: 'primary',
    border: 1,
    lineHeight: 'title',
    height: 28,
    px: 8,
    cursor: 'pointer',
    transition: '100ms ease-in',
    transitionProperty: 'color',
    '&:hover': {
      color: 'primary-hover',
    },
  })
  .asComponent('button');

export const Header = () => {
  const { asPath } = useRouter();
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  const isHomepage = asPath === '/';

  return (
    <HeaderContainer bordered={!isHomepage}>
      <HeaderSection direction="left">
        {!isHomepage && (
          <Link href="/">
            <Logo>Animus</Logo>
          </Link>
        )}
      </HeaderSection>
      <HeaderSection direction="right">
        {navlinks.map(({ text, href }) => (
          <Link href={href} active={false} key={href} fontWeight={600}>
            {text}
          </Link>
        ))}
        <Button onClick={onChangeMode}>{mode}</Button>
      </HeaderSection>
    </HeaderContainer>
  );
};
