import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { MarkdownContent } from './components/docs/MarkdownContent';
import type { NavEntry } from './constants/docsNav';
import { DOCS_NAV, hasChildren } from './constants/docsNav';
import { DocsLayout } from './layout/DocsLayout';
import { Shell } from './layout/Shell';

const Home = lazy(() => import('./pages/Home'));
const Examples = lazy(() => import('./pages/Examples'));

const contentModules = import.meta.glob('./content/**/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function DocPage({ contentKey }: { contentKey: string }) {
  const [content, setContent] = useState<string | null>(null);
  const loader = contentModules[`./content/${contentKey}.md`];

  useEffect(() => {
    setContent(null);
    if (loader) {
      loader().then(setContent);
    }
  }, [loader]);

  if (!loader) return <NotFound />;
  if (content === null) return null;
  return <MarkdownContent source={content} />;
}

function generateDocRoutes(nav: NavEntry[]) {
  return nav.map((entry) => {
    if (hasChildren(entry)) {
      const segment = entry.path.replace('/docs/', '');
      const firstChild = entry.children[0];
      return (
        <Route path={segment} key={entry.path}>
          <Route index element={<Navigate to={firstChild.path} replace />} />
          {entry.children.map((child) => {
            const childSegment = child.path.split('/').pop()!;
            const contentKey = child.path.replace('/docs/', '');
            return (
              <Route
                key={child.path}
                path={childSegment}
                element={<DocPage contentKey={contentKey} />}
              />
            );
          })}
        </Route>
      );
    }

    // Top-level leaf entries
    if (entry.path === '/docs') {
      return (
        <Route
          key={entry.path}
          index
          element={<DocPage contentKey="introduction" />}
        />
      );
    }

    // Examples is a custom component, not markdown
    if (entry.path === '/docs/examples') {
      return (
        <Route
          key={entry.path}
          path="examples"
          element={
            <Suspense>
              <Examples />
            </Suspense>
          }
        />
      );
    }

    const segment = entry.path.replace('/docs/', '');
    return (
      <Route
        key={entry.path}
        path={segment}
        element={<DocPage contentKey={segment} />}
      />
    );
  });
}

function NotFound() {
  return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <h1
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '2rem' }}
      >
        404
      </h1>
      <p style={{ color: 'var(--color-textMuted)' }}>Page not found.</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route
            index
            element={
              <Suspense>
                <Home />
              </Suspense>
            }
          />
          <Route path="docs" element={<DocsLayout />}>
            {generateDocRoutes(DOCS_NAV)}
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
