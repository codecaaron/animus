import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers scroll reset on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
