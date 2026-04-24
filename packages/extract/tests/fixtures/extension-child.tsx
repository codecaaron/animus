import { Anchor } from './extension-parent';

export const NavLink = Anchor.extend()
  .styles({ textDecoration: 'none' })
  .states({ active: { color: 'secondary' } })
  .asElement('a');

// JSX usage to test system prop scanning across extension
export function Nav() {
  return (
    <NavLink p={8} fontSize={16} href="/home">
      Home
    </NavLink>
  );
}
