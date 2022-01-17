import { animus } from '@animus-ui/core';
import { useColorModes, Link, FlexBox } from '@animus-ui/components';
import { useRouter } from 'next/dist/client/router';
import { useContext } from 'react';
import { ThemeControlContext } from '../AppProvider/AppWrapper';
import { navlinks } from './constants';
import { keyframes } from '@emotion/react';
import { Logo } from 'components/Logo/Logo';

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

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    justifyContent: 'center',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: '4rem',
    area: 'header',
    overflow: 'hidden',
    py: 4,
    px: 32,
    zIndex: 2,
  })
  .states({
    bordered: {
      '&::after': {
        position: 'absolute',
        content: '""',
        height: '2px',
        bottom: 0,
        left: -32,
        right: -32,
        backgroundImage: ({ colors }) =>
          `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
        backgroundSize: '300px 100px',
        animation: ` ${slide} 5s linear infinite`,
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

const Button = animus
  .styles({
    borderRadius: 4,
    boxShadow: 'none',
    fontSize: 16,
    fontWeight: 700,
    py: 4,
    px: 12,
    cursor: 'pointer',
    color: 'background-current',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    animation: ` ${slide} 5s linear 1s infinite`,
    border: 'none',
    '&:hover': {
      backgroundSize: '150%',
      backgroundPosition: '100%',
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
            <Logo logoSize="md">Animus</Logo>
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
