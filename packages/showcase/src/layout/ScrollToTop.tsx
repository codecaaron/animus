import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname } = useLocation();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- pathname triggers scroll reset on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
