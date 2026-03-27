import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { Shell } from './layout/Shell';

const Home = lazy(() => import('./pages/Home'));
const Docs = lazy(() => import('./pages/Docs'));

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
          <Route
            path="docs"
            element={
              <Suspense>
                <Docs />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
