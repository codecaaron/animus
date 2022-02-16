import { Link, Text, useColorModes } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { flow, FlowLink } from 'components/FlowLink';
import { Logo } from 'components/Logo/Logo';
import { useRouter } from 'next/dist/client/router';
import { useContext } from 'react';

import { ThemeControlContext } from '../AppProvider/ThemeControl';
import { navlinks } from './constants';

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    justifyContent: 'center',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: '4.5rem',
    area: 'header',
    overflow: 'hidden',
    py: 4,
    px: 32,
    zIndex: 2,
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
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 'title',
    px: 8,
    minHeight: 28,
    pb: 4,
    minWidth: 60,
    fontFamily: 'mono',
    cursor: 'pointer',
    color: 'background-current',
    gradient: 'flowX',
    animation: ` ${flow} 5s linear 1s infinite`,
    border: 'none',
    backgroundSize: '150%',
  })
  .asComponent('button');

export const Header = () => {
  const { asPath } = useRouter();
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  const isHomepage = asPath === '/';

  return (
    <HeaderContainer>
      <HeaderSection direction="left">
        {!isHomepage && (
          <Link href="/">
            <Logo link logoSize={{ _: 'sm', xs: 'md' }}>
              A<Text display={{ _: 'none', xs: 'inline' }}>nimus</Text>
            </Logo>
          </Link>
        )}
      </HeaderSection>
      <HeaderSection direction="right">
        {navlinks.map(({ text, href }) => (
          <FlowLink fontSize={18} href={href} active={false} key={href} raised>
            {text}
          </FlowLink>
        ))}
        <Button onClick={onChangeMode}>{mode}</Button>
      </HeaderSection>
    </HeaderContainer>
  );
};
