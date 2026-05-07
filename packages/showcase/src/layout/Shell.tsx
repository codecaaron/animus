import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { Drawer, NavBar, NavDivider, NavItem, SkipLink } from '../components';
import { ColorPalette } from '../components/docs/ColorPalette';
import { DocsBreadcrumb } from '../components/docs/DocsBreadcrumb';
import { Sidebar } from '../components/docs/Sidebar';
import { DOCS_NAV, hasChildren } from '../constants/docsNav';
import { ds } from '../ds';
import { ScrollToTop } from './ScrollToTop';

const Main = ds
  .styles({
    minHeight: '100vh',
  })
  .asElement('main');

// ─── Color Mode Trigger ───────────────────────────────────────────

const ModeTrigger = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'text.muted',
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'primary' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '2px',
    },
  })
  .asElement('button');

// ─── Breadcrumb Resolution ────────────────────────────────────────

function resolveBreadcrumb(pathname: string) {
  for (const entry of DOCS_NAV) {
    if (hasChildren(entry)) {
      if (entry.path === pathname) return { section: entry.label };
      for (const child of entry.children) {
        if (child.path === pathname)
          return { section: entry.label, page: child.label };
      }
    } else if (entry.path === pathname) {
      return { section: entry.label };
    }
  }
  return {};
}

// ─── Shell ────────────────────────────────────────────────────────

export function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebarTriggerRef = useRef<HTMLElement | null>(null);
  const paletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const isDocsRoute = location.pathname.startsWith('/docs');
  const breadcrumb = isDocsRoute ? resolveBreadcrumb(location.pathname) : {};

  // Close sidebar drawer on navigation
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- pathname triggers close on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Read current mode for the trigger label
  const [modeLabel, setModeLabel] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-color-mode') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const mode =
        document.documentElement.getAttribute('data-color-mode') || 'dark';
      setModeLabel(mode);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <ScrollToTop />
      <SkipLink href="#main-content">Skip to content →</SkipLink>

      {/* Single nav tree — responsive display inside variant CSS */}
      <NavBar.Root mode="inline">
        <NavBar.Container>
          <NavLink to="/" style={{ textDecoration: 'none' }}>
            <NavBar.Brand>Animus</NavBar.Brand>
          </NavLink>
          <NavBar.Links>
            <NavLink to="/docs">
              {({ isActive }) => (
                <NavItem className={isActive ? 'active' : ''}>docs</NavItem>
              )}
            </NavLink>
          </NavBar.Links>
          <NavBar.Actions>
            <NavDivider />
            <ModeTrigger
              ref={paletteTriggerRef}
              onClick={() => setPaletteOpen(true)}
              aria-expanded={paletteOpen}
              aria-label="Choose color mode"
            >
              {modeLabel}
            </ModeTrigger>
          </NavBar.Actions>
        </NavBar.Container>
      </NavBar.Root>

      <Drawer
        open={sidebarOpen}
        onClose={closeSidebar}
        position="left"
        label="Site navigation"
        triggerRef={sidebarTriggerRef}
      >
        <Sidebar />
      </Drawer>

      <Drawer
        open={paletteOpen}
        onClose={closePalette}
        position="right"
        label="Color mode"
        triggerRef={paletteTriggerRef}
      >
        <ColorPalette />
      </Drawer>

      <Main id="main-content">
        {isDocsRoute && (
          <DocsBreadcrumb
            section={breadcrumb.section}
            page={breadcrumb.page}
            onClick={() => setSidebarOpen(true)}
          />
        )}
        <Outlet />
      </Main>
    </>
  );
}
