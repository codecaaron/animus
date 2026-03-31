import { NavLink, Outlet } from 'react-router-dom';

import { ColorModeToggle } from '../components';
import { ds } from '../ds';
import { ScrollToTop } from './ScrollToTop';

const Nav = ds
  .styles({
    position: 'sticky',
    top: '0',
    zIndex: '100',
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    px: 24,
    py: 12,
    bg: 'bg',
    borderBottom: 1,
    borderColor: 'border',
  })
  .system({ surface: true })
  .asElement('nav');

const NavBrand = ds
  .styles({
    fontFamily: 'logo',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '2px',
    color: 'primary',
  })
  .asElement('span');

const NavItem = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.muted',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'text' },
    '&.active': { color: 'primary' },
  })
  .asElement('a');

const NavSpacer = ds
  .styles({
    flex: '1',
  })
  .asElement('div');

const NavDivider = ds
  .styles({
    width: '1px',
    height: '16px',
    bg: 'border',
  })
  .asElement('div');

const Main = ds
  .styles({
    minHeight: '100vh',
  })
  .asElement('main');

export function Shell() {
  return (
    <>
      <ScrollToTop />
      <Nav>
        <NavLink to="/" style={{ textDecoration: 'none' }}>
          <NavBrand>Animus</NavBrand>
        </NavLink>
        <NavLink to="/" end>
          {({ isActive }) => (
            <NavItem className={isActive ? 'active' : ''}>home</NavItem>
          )}
        </NavLink>
        <NavLink to="/docs">
          {({ isActive }) => (
            <NavItem className={isActive ? 'active' : ''}>docs</NavItem>
          )}
        </NavLink>
        <NavSpacer />
        <NavDivider />
        <ColorModeToggle />
      </Nav>
      <Main>
        <Outlet />
      </Main>
    </>
  );
}
