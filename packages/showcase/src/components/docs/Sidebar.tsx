import { compose } from '@animus-ui/system';
import { NavLink } from 'react-router-dom';

import {
  DOCS_NAV,
  hasChildren,
  type NavEntry,
  type NavSection,
} from '../../constants/docsNav';
import { ds } from '../../ds';

// ─── Sidebar Slot Definitions ──────────────────────────────────────
//
// Two-level sidebar: L1 sections + L2 page items.
// Shared `density` variant controls spacing across all slots.

export const SidebarRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    py: 8,
  })
  .variant({
    prop: 'density',
    defaultVariant: 'comfortable',
    variants: {
      compact: { gap: 2 },
      comfortable: { gap: 4 },
    },
  })
  .asElement('nav');

export const SidebarSection = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .variant({
    prop: 'density',
    defaultVariant: 'comfortable',
    variants: {
      compact: { gap: 0, mb: 4 },
      comfortable: { gap: 2, mb: 8 },
    },
  })
  .asElement('div');

const SidebarSectionLabel = ds
  .styles({
    fontFamily: 'mono',
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'text.muted',
  })
  .variant({
    prop: 'density',
    defaultVariant: 'comfortable',
    variants: {
      compact: { fontSize: 11, py: 4, px: 8 },
      comfortable: { fontSize: 12, py: 6, px: 12 },
    },
  })
  .asElement('span');

export const SidebarItem = ds
  .styles({
    fontFamily: 'mono',
    color: 'text.dim',
    textDecoration: 'none',
    borderLeft: 2,
    borderColor: 'transparent',
    transition: 'color 0.15s ease, border-color 0.15s ease',
    '&:hover': { color: 'text' },
    '&.active': { color: 'primary', borderColor: 'primary' },
  })
  .variant({
    prop: 'density',
    defaultVariant: 'comfortable',
    variants: {
      compact: { fontSize: 12, py: 4, px: 8, pl: 16 },
      comfortable: { fontSize: 13, py: 4, px: 12, pl: 24 },
    },
  })
  .asElement('a');

export const Nav = compose(
  {
    Root: SidebarRoot,
    Section: SidebarSection,
    Label: SidebarSectionLabel,
    Item: SidebarItem,
  },
  { shared: { density: true } }
);

// ─── Sidebar Component ─────────────────────────────────────────────

function SidebarLink({ entry, end }: { entry: NavEntry; end?: boolean }) {
  return (
    <NavLink to={entry.path} end={end}>
      {({ isActive }) => (
        <Nav.Item className={isActive ? 'active' : ''}>{entry.label}</Nav.Item>
      )}
    </NavLink>
  );
}

function SidebarGroup({ section }: { section: NavSection }) {
  return (
    <Nav.Section>
      <Nav.Label>{section.label}</Nav.Label>
      {section.children.map((child) => (
        <SidebarLink key={child.path} entry={child} />
      ))}
    </Nav.Section>
  );
}

export function Sidebar() {
  return (
    <Nav.Root density="comfortable" aria-label="Documentation">
      {DOCS_NAV.map((entry) =>
        hasChildren(entry) ? (
          <SidebarGroup key={entry.path} section={entry} />
        ) : (
          <SidebarLink
            key={entry.path}
            entry={entry}
            end={entry.path === '/docs'}
          />
        )
      )}
    </Nav.Root>
  );
}
