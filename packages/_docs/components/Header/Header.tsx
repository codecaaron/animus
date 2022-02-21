import { Box, Link } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { ModeToggle } from 'components/Header/ModeToggle';
import { Logo } from 'components/Logo/Logo';
import { FlowLink } from 'elements/FlowLink';
import { useRouter } from 'next/router';

const LINKS = [
  { href: '/docs/start', text: 'Docs' },
  { href: 'https://github.com/codecaaron/animus', text: 'Github' },
];

const HeaderSection = animus
  .styles({
    display: 'grid',
    gap: { _: 24, sm: 32 },
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
    <>
      <HeaderSection direction="left">
        {!isHomepage && (
          <Link href="/">
            <Logo link logoSize={['xs', 'sm']}>
              Animus
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

        <Box display={{ _: 'none', xs: 'block' }}>
          <ModeToggle />
        </Box>
      </HeaderSection>
    </>
  );
};
