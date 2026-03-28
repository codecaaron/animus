import { NavLink } from 'react-router-dom';

import { ds } from '../../ds';
import { TableOfContents } from './TableOfContents';

const SidebarNav = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    position: 'sticky',
    top: '48px',
    width: '200px',
    flexShrink: '0',
    py: 8,
    maxHeight: 'calc(100vh - 60px)',
    overflowY: 'auto',
  })
  .asElement('nav');

const SidebarLink = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: 'text-muted',
    textDecoration: 'none',
    py: 6,
    px: 12,
    borderLeft: 2,
    borderColor: 'transparent',
    transition: 'color 0.15s ease, border-color 0.15s ease',
    '&:hover': { color: 'text' },
    '&.active': { color: 'primary', borderColor: 'primary' },
  })
  .asElement('a');

const DOCS_LINKS = [
  { label: 'Why Animus', path: '/docs' },
  { label: 'Getting Started', path: '/docs/start' },
  { label: 'Core Concepts', path: '/docs/concepts' },
  { label: 'API Reference', path: '/docs/api' },
  { label: 'Examples', path: '/docs/examples' },
];

export function Sidebar() {
  return (
    <SidebarNav>
      {DOCS_LINKS.map((link) => (
        <NavLink key={link.path} to={link.path} end={link.path === '/docs'}>
          {({ isActive }) => (
            <SidebarLink className={isActive ? 'active' : ''}>
              {link.label}
            </SidebarLink>
          )}
        </NavLink>
      ))}
      <TableOfContents />
    </SidebarNav>
  );
}
