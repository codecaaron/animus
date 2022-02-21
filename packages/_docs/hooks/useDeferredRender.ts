import { useState } from 'react';

import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export const useDeferredRender = () => {
  const [ready, setReady] = useState(false);
  useIsomorphicLayoutEffect(() => {
    setReady(true);
  }, []);
  return ready;
};
