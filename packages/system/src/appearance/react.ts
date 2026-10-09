import { useSyncExternalStore } from 'react';

import type { ColorModeController } from './controller.js';

/**
 * The controller's setting and its setter. A server render, and the first
 * client render that hydrates it, read the default setting, so a stored
 * setting arrives in the render after hydration.
 */
export function useColorMode(
  controller: ColorModeController
): [mode: string, setMode: (mode: string) => void] {
  const mode = useSyncExternalStore(
    controller.subscribe,
    controller.get,
    controller.getDefault
  );
  return [mode, controller.set];
}
