import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { ds } from '../../ds';

const TocContainer = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    py: 8,
  })
  .asElement('nav');

const TocHeading = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    px: 12,
    py: 4,
    mb: 4,
  })
  .asElement('div');

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

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export function PageToc() {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const { pathname } = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers re-scan when route changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const headings = document.querySelectorAll<HTMLElement>('h2[id], h3[id]');
      const items: TocEntry[] = [];
      for (const el of headings) {
        const level = el.tagName === 'H2' ? 2 : 3;
        items.push({
          id: el.id,
          text: el.textContent?.trim() || '',
          level: level as 2 | 3,
        });
      }
      setEntries(items);
      setActiveId('');
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname]);

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

  if (entries.length < 2) return null;

  return (
    <TocContainer aria-label="On this page">
      <TocHeading>On this page</TocHeading>
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
    </TocContainer>
  );
}
