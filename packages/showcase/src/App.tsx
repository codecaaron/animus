import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { DocsLayout } from './layout/DocsLayout';
import { Shell } from './layout/Shell';

const Home = lazy(() => import('./pages/Home'));
const Why = lazy(() => import('./pages/Why'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));
const Examples = lazy(() => import('./pages/Examples'));

// Concepts
const BuilderChain = lazy(() => import('./pages/concepts/BuilderChain'));
const CascadeContract = lazy(() => import('./pages/concepts/CascadeContract'));
const DesignTokens = lazy(() => import('./pages/concepts/DesignTokens'));
const ResponsiveProps = lazy(() => import('./pages/concepts/ResponsiveProps'));
const VariantsStates = lazy(() => import('./pages/concepts/VariantsStates'));
const SlotComposition = lazy(() => import('./pages/concepts/SlotComposition'));

// API Reference
const CreateTheme = lazy(() => import('./pages/api/CreateTheme'));
const CreateSystem = lazy(() => import('./pages/api/CreateSystem'));
const BuilderChainApi = lazy(() => import('./pages/api/BuilderChainApi'));
const CreateTransform = lazy(() => import('./pages/api/CreateTransform'));
const PropGroups = lazy(() => import('./pages/api/PropGroups'));
const VitePlugin = lazy(() => import('./pages/api/VitePlugin'));

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

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route
            index
            element={
              <Page>
                <Home />
              </Page>
            }
          />
          <Route path="docs" element={<DocsLayout />}>
            <Route
              index
              element={
                <Page>
                  <Why />
                </Page>
              }
            />
            <Route
              path="start"
              element={
                <Page>
                  <GettingStarted />
                </Page>
              }
            />

            {/* Core Concepts — nested routes */}
            <Route path="concepts">
              <Route
                index
                element={<Navigate to="/docs/concepts/builder-chain" replace />}
              />
              <Route
                path="builder-chain"
                element={
                  <Page>
                    <BuilderChain />
                  </Page>
                }
              />
              <Route
                path="cascade-contract"
                element={
                  <Page>
                    <CascadeContract />
                  </Page>
                }
              />
              <Route
                path="design-tokens"
                element={
                  <Page>
                    <DesignTokens />
                  </Page>
                }
              />
              <Route
                path="responsive-props"
                element={
                  <Page>
                    <ResponsiveProps />
                  </Page>
                }
              />
              <Route
                path="variants-states"
                element={
                  <Page>
                    <VariantsStates />
                  </Page>
                }
              />
              <Route
                path="slot-composition"
                element={
                  <Page>
                    <SlotComposition />
                  </Page>
                }
              />
            </Route>

            {/* API Reference — nested routes */}
            <Route path="api">
              <Route
                index
                element={<Navigate to="/docs/api/create-theme" replace />}
              />
              <Route
                path="create-theme"
                element={
                  <Page>
                    <CreateTheme />
                  </Page>
                }
              />
              <Route
                path="create-system"
                element={
                  <Page>
                    <CreateSystem />
                  </Page>
                }
              />
              <Route
                path="builder-chain"
                element={
                  <Page>
                    <BuilderChainApi />
                  </Page>
                }
              />
              <Route
                path="create-transform"
                element={
                  <Page>
                    <CreateTransform />
                  </Page>
                }
              />
              <Route
                path="prop-groups"
                element={
                  <Page>
                    <PropGroups />
                  </Page>
                }
              />
              <Route
                path="vite-plugin"
                element={
                  <Page>
                    <VitePlugin />
                  </Page>
                }
              />
            </Route>

            <Route
              path="examples"
              element={
                <Page>
                  <Examples />
                </Page>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
