import { useCallback, useEffect, useRef, useState } from 'react';

import { ds } from '../../ds';

// ─── ExampleNav Styled Components ─────────────────────────────────

const NavStrip = ds
  .styles({
    position: 'sticky',
    top: '{sizes.navHeight}',
    zIndex: '50',
    display: { _: 'flex', md: 'none' },
    alignItems: 'stretch',
    bg: 'bg',
    borderTop: 1,
    borderBottom: 1,
    borderColor: 'border',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    minWidth: '0',
    maxWidth: '100%',
    '&::-webkit-scrollbar': { display: 'none' },
  })
  .asElement('nav');

const NavTab = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'text.dim',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    border: 'none',
    borderBottom: 2,
    borderColor: 'transparent',
    bg: 'transparent',
    px: 12,
    py: 8,
    transition: 'color 0.15s ease, border-color 0.15s ease',
    '&:hover': { color: 'text.muted' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '-2px',
    },
  })
  .states({
    active: {
      color: 'primary',
      borderColor: 'primary',
    },
  })
  .asElement('button');

const NavSeparator = ds
  .styles({
    width: '1px',
    alignSelf: 'stretch',
    bg: 'border',
    flexShrink: '0',
  })
  .asElement('div');

// ─── Section Configuration ────────────────────────────────────────

export interface ExampleSection {
  id: string;
  label: string;
}

// ─── ExampleNav Component ─────────────────────────────────────────

interface ExampleNavProps {
  sections: ExampleSection[];
}

export function ExampleNav({ sections }: ExampleNavProps) {
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // IntersectionObserver for active section tracking
  useEffect(() => {
    if (sections.length === 0) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const visibleIds = new Set<string>();

    observerRef.current = new IntersectionObserver(
      (intersections) => {
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            visibleIds.add(entry.target.id);
          } else {
            visibleIds.delete(entry.target.id);
          }
        }

        // First visible section in document order wins
        for (const section of sections) {
          if (visibleIds.has(section.id)) {
            setActiveId(section.id);
            return;
          }
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observerRef.current.observe(el);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [sections]);

  // Handle initial load with hash
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActiveId(hash);
        }, 100);
      }
    }
  }, []);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      window.history.replaceState(null, '', `#${id}`);
    }
  }, []);

  return (
    <NavStrip role="tablist" aria-label="Example sections">
      {sections.map((section, i) => (
        <>
          {i > 0 && (
            <NavSeparator key={`sep-${section.id}`} aria-hidden="true" />
          )}
          <NavTab
            key={section.id}
            role="tab"
            aria-selected={activeId === section.id}
            active={activeId === section.id}
            onClick={() => scrollTo(section.id)}
          >
            {section.label}
          </NavTab>
        </>
      ))}
    </NavStrip>
  );
}
