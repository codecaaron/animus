import { useEffect, useRef, useState } from 'react';

import { ds } from '../../ds';

// ─── Styled Elements ────────────────────────────────────────

const TocNav = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  })
  .asElement('nav');

const TocLink = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    color: 'text.dim',
    textDecoration: 'none',
    py: 4,
    px: 12,
    borderLeft: 2,
    borderColor: 'transparent',
    transition: 'color 0.15s ease, border-color 0.15s ease',
    '&:hover': { color: 'text.muted' },
  })
  .variant({
    prop: 'depth',
    variants: {
      2: { color: 'text.muted' },
      3: { pl: 24, fontSize: 11 },
    },
  })
  .states({
    active: { color: 'primary', borderColor: 'primary' },
  })
  .asElement('a');

const TocDivider = ds
  .styles({
    height: '1px',
    bg: 'border',
    my: 12,
    mx: 12,
  })
  .asElement('div');

// ─── Types ──────────────────────────────────────────────────

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

// ─── Component ──────────────────────────────────────────────

export function TableOfContents() {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Scan headings on route change
  useEffect(() => {
    // Small delay to let the page render
    const timer = setTimeout(() => {
      const headings = document.querySelectorAll<HTMLElement>('h2[id], h3[id]');
      const items: TocEntry[] = [];
      headings.forEach((el) => {
        const level = el.tagName === 'H2' ? 2 : 3;
        items.push({
          id: el.id,
          text: el.textContent?.trim() || '',
          level: level as 2 | 3,
        });
      });
      setEntries(items);
      setActiveId('');
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Track active heading via IntersectionObserver
  useEffect(() => {
    if (entries.length === 0) return;

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

        // Pick the first visible heading in document order
        for (const item of entries) {
          if (visibleIds.has(item.id)) {
            setActiveId(item.id);
            return;
          }
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    for (const item of entries) {
      const el = document.getElementById(item.id);
      if (el) observerRef.current.observe(el);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [entries]);

  if (entries.length < 3) return null;

  return (
    <>
      <TocDivider />
      <TocNav aria-label="Table of contents">
        {entries.map((entry) => (
          <TocLink
            key={entry.id}
            href={`#${entry.id}`}
            depth={String(entry.level) as '2' | '3'}
            active={activeId === entry.id}
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.preventDefault();
              const el = document.getElementById(entry.id);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveId(entry.id);
                window.history.replaceState(null, '', `#${entry.id}`);
              }
            }}
          >
            {entry.text}
          </TocLink>
        ))}
      </TocNav>
    </>
  );
}
