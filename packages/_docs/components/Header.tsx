import { animus } from '@animus/props';
import { Link } from '@animus/ui';
import { ModeToggle } from './ModeToggle';

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    area: 'header',
    borderBottom: 1,
    borderColor: 'pink-200',
    py: 12,
    px: 24,
  })
  .asComponent('div');

const HeaderSection = animus
  .styles({
    display: 'grid',
    gap: 16,
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
    fontSize: 26,
    fontWeight: 700,
    m: 0,
    letterSpacing: '4px',
    fontFamily: 'title',
  })
  .asComponent('h1');

export const Header = () => {
  console.log();
  return (
    <HeaderContainer>
      <HeaderSection direction="left">
        <Link href="/">
          <Logo>Animus</Logo>
        </Link>
      </HeaderSection>
      <HeaderSection direction="right">
        <ModeToggle />
      </HeaderSection>
    </HeaderContainer>
  );
};
