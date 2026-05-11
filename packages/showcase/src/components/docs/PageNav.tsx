import { useLocation } from 'react-router-dom';

import { DOCS_NAV, hasChildren, type NavItem } from '../../constants/docsNav';
import { ds } from '../../ds';

// ─── Flatten nav into ordered page list ──────────────────────────

function flattenNav(): NavItem[] {
  const pages: NavItem[] = [];
  for (const entry of DOCS_NAV) {
    pages.push({ label: entry.label, path: entry.path });
    if (hasChildren(entry)) {
      for (const child of entry.children) {
        pages.push(child);
      }
    }
  }
  return pages;
}

const ALL_PAGES = flattenNav();

// ─── Styled Elements ─────────────────────────────────────────────

const NavRow = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    mt: 48,
  })
  .asElement('nav');

const NavCard = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    p: 12,
    fontFamily: 'mono',
    color: 'text',
    textDecoration: 'none',
    bg: 'transparent',
    border: 1,
    borderColor: 'border',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      boxShadow: 'glow-accent',
      textDecoration: 'none',
    },
  })
  .asElement('a');

const NavDirection = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
  })
  .asElement('span');

const NavLabel = ds
  .styles({
    fontSize: 13,
    fontWeight: 500,
    color: 'text.muted',
  })
  .asElement('span');

// ─── Component ───────────────────────────────────────────────────

export function PageNav() {
  const { pathname } = useLocation();
  const idx = ALL_PAGES.findIndex((p) => p.path === pathname);

  if (idx === -1) return null;

  const prev = idx > 0 ? ALL_PAGES[idx - 1] : null;
  const next = idx < ALL_PAGES.length - 1 ? ALL_PAGES[idx + 1] : null;

  if (!prev && !next) return null;

  return (
    <NavRow aria-label="Page navigation">
      {prev ? (
        <NavCard href={prev.path} style={{ textAlign: 'left' }}>
          <NavDirection>← prev</NavDirection>
          <NavLabel>{prev.label}</NavLabel>
        </NavCard>
      ) : (
        <div />
      )}
      {next ? (
        <NavCard href={next.path} style={{ textAlign: 'right' }}>
          <NavDirection>next →</NavDirection>
          <NavLabel>{next.label}</NavLabel>
        </NavCard>
      ) : (
        <div />
      )}
    </NavRow>
  );
}
