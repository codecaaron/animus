import { animus } from '~animus';
import { useColorModes, Link } from '@animus/ui';
import { useRouter } from 'next/dist/client/router';
import { useContext } from 'react';
import { ThemeControlContext } from '../AppProvider/AppWrapper';
import { navlinks } from './constants';

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
  })
  .variant({
    variants: {
      shadowed: {
        boxShadow: ({ colors }) => `0 0 32px ${colors['modifier-darken-300']}`,
      },
      bordered: {
        borderBottom: 1,
        boxShadow: 'none',
      },
      plain: {
        bg: 'transparent',
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
    fontWeight: 400,
    color: 'primary',
    border: 1,
    lineHeight: 'title',
    height: 28,
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
  const { asPath } = useRouter();
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  const isHomepage = asPath === '/';

  const variant = mode === 'light' ? 'bordered' : 'shadowed';
  const activeVariant = isHomepage ? 'plain' : variant;
  return (
    <HeaderContainer variant={activeVariant}>
      <HeaderSection direction="left">
        {!isHomepage && (
          <Link href="/">
            <Logo>Animus</Logo>
          </Link>
        )}
      </HeaderSection>
      <HeaderSection direction="right">
        {navlinks.map(({ text, href }) => (
          <Link href={href} active={false} key={href}>
            {text}
          </Link>
        ))}
        <Button onClick={onChangeMode}>{mode}</Button>
      </HeaderSection>
    </HeaderContainer>
  );
};
