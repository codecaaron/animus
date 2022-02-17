import { Link, Text } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { Logo } from 'components/Logo/Logo';
import { ModeToggle } from 'components/ModeButton';
import { FlowLink } from 'elements/FlowLink';
import { useRouter } from 'next/dist/client/router';

const LINKS = [
  { href: '/docs/start', text: 'Docs' },
  { href: 'https://github.com/codecaaron/animus', text: 'Github' },
];

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    justifyContent: 'center',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: ['3.5rem', '4.5rem'],
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

export const Header = () => {
  const { asPath } = useRouter();

  const isHomepage = asPath === '/';

  return (
    <HeaderContainer>
      <HeaderSection direction="left">
        {!isHomepage && (
          <Link href="/">
            <Logo link logoSize="sm">
              A<Text display={{ _: 'none', xs: 'inline' }}>nimus</Text>
            </Logo>
          </Link>
        )}
      </HeaderSection>
      <HeaderSection direction="right">
        {LINKS.map(({ text, href }) => (
          <FlowLink fontSize={18} href={href} active={false} key={href} raised>
            {text}
          </FlowLink>
        ))}
        <ModeToggle />
      </HeaderSection>
    </HeaderContainer>
  );
};
