import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

import { DocsLayout } from './layout/DocsLayout';
import { Shell } from './layout/Shell';

const Home = lazy(() => import('./pages/Home'));
const Examples = lazy(() => import('./pages/Examples'));

// The MDX guides were deleted, not archived: the system-definition API is
// still settling and every written page had drifted into teaching shapes
// the current pipeline rejects. Examples stay — they are extracted, built,
// and asserted on every verify run, so they cannot silently drift.
function DocsPlaceholder() {
  return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <h1
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '2rem' }}
      >
        Documentation is offline
      </h1>
      <p
        style={{
          color: 'var(--color-textMuted)',
          maxWidth: '46ch',
          margin: '1rem auto',
        }}
      >
        The system-definition API is still settling, and written guides kept
        drifting out of truth. They have been removed until the API freezes. The{' '}
        <Link to="/docs/examples">Examples</Link> are live, extracted code and
        remain accurate.
      </p>
    </div>
  );
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
            <Route index element={<DocsPlaceholder />} />
            <Route
              path="examples"
              element={
                <Suspense>
                  <Examples />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
