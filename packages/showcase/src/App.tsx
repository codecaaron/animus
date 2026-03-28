import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { DocsLayout } from './layout/DocsLayout';
import { Shell } from './layout/Shell';

const Home = lazy(() => import('./pages/Home'));
const Why = lazy(() => import('./pages/Why'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));
const Concepts = lazy(() => import('./pages/Concepts'));
const ApiReference = lazy(() => import('./pages/ApiReference'));
const Examples = lazy(() => import('./pages/Examples'));

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
            <Route
              index
              element={
                <Suspense>
                  <Why />
                </Suspense>
              }
            />
            <Route
              path="start"
              element={
                <Suspense>
                  <GettingStarted />
                </Suspense>
              }
            />
            <Route
              path="concepts"
              element={
                <Suspense>
                  <Concepts />
                </Suspense>
              }
            />
            <Route
              path="api"
              element={
                <Suspense>
                  <ApiReference />
                </Suspense>
              }
            />
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
