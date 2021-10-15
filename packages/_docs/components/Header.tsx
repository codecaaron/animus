import { animus } from '@animus/props';

const HeaderContainer = animus
  .styles({
    height: '5rem',
    display: 'flex',
    p: 16,
    px: 32,
  })
  .asComponent('div');

const HeaderSection = animus
  .styles({
    display: 'grid',
    gap: 16,
    alignItems: 'center',
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
    textTransform: 'uppercase',
    fontSize: 18,
    fontWeight: 700,
  })
  .asComponent('h1');

const IconButton = animus.styles({
  p: 4,
  size: 40,
});

const Header = () => {
  <HeaderContainer>
    <HeaderSection direction="left">
      <Logo>Animus</Logo>
    </HeaderSection>
    <HeaderSection direction="right">
      <IconButton>Hi</IconButton>
    </HeaderSection>
  </HeaderContainer>;
};
