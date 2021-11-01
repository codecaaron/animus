import { animus } from '@animus/props';
import { useColorModes } from '@animus/provider';
import { Link } from '@animus/ui';
import { createContext, useContext } from 'react';
import { navlinks } from './constants';

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: '3.5rem',
    area: 'header',
    py: 4,
    px: 24,
    zIndex: 2,
    boxShadow: ({ colors }) => `0 0 32px ${colors['modifier-darken-300']}`,
  })
  .states({
    bordered: {
      border: 1,
      boxShadow: 'none',
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
    fontSize: 26,
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
    borderRadius: '4px',
    bg: 'transparent',
    boxShadow: 'none',
    fontSize: 14,
    fontWeight: 600,
    color: 'primary',
    border: 2,
    lineHeight: 'title',
    minHeight: 32,
    px: 8,
    borderColor: 'currentColor',
    cursor: 'pointer',
    transition: '200ms ease-in',
    transitionProperty: 'background-color',
    '&:hover': {
      bg: 'background-emphasized',
    },
  })
  .asComponent('button');

export const Header = () => {
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);
  return (
    <HeaderContainer bordered={mode === 'light'}>
      <HeaderSection direction="left">
        <Link href="/">
          <Logo>Animus</Logo>
        </Link>
      </HeaderSection>
      <HeaderSection direction="right">
        {navlinks.map(({ text, href }) => (
          <Link href={href}>{text}</Link>
        ))}
        <Button onClick={onChangeMode}>{mode}</Button>
      </HeaderSection>
    </HeaderContainer>
  );
};
