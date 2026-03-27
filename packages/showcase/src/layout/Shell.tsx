import { Outlet, NavLink } from 'react-router-dom';

import { ds } from '../ds';

const Nav = ds
  .styles({
    position: 'sticky',
    top: '0',
    zIndex: '100',
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    px: 24,
    py: 12,
    bg: 'background',
    borderBottom: '1px solid',
    borderColor: 'ash',
  })
  .groups({ surface: true })
  .asElement('nav');

const NavBrand = ds
  .styles({
    fontFamily: 'logo',
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '2px',
    color: 'primary',
  })
  .asElement('span');

const NavItem = ds
  .styles({
    fontFamily: 'mono',
    fontSize: '12px',
    letterSpacing: '0.1em',
    color: 'textMuted',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'text' },
    '&.active': { color: 'primary' },
  })
  .asElement('a');

const Main = ds
  .styles({
    minHeight: '100vh',
  })
  .asElement('main');

export function Shell() {
  return (
    <>
      <Nav>
        <NavLink to="/" style={{ textDecoration: 'none' }}>
          <NavBrand>animus</NavBrand>
        </NavLink>
        <NavLink to="/" end>
          {({ isActive }) => <NavItem className={isActive ? 'active' : ''}>home</NavItem>}
        </NavLink>
        <NavLink to="/docs">
          {({ isActive }) => <NavItem className={isActive ? 'active' : ''}>docs</NavItem>}
        </NavLink>
      </Nav>
      <Main>
        <Outlet />
      </Main>
    </>
  );
}
