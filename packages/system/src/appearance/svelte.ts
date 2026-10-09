import type { ColorModeController } from './controller.js';

/** Svelte's writable store contract, restated so `svelte` is not imported. */
export interface ColorModeStore {
  subscribe(run: (mode: string) => void): () => void;
  set(mode: string): void;
}

/** The controller as a Svelte store: `$store` reads the setting, and
 *  `$store = 'dark'` sets it. */
export function colorModeStore(
  controller: ColorModeController
): ColorModeStore {
  return {
    subscribe(run) {
      run(controller.get());
      return controller.subscribe(run);
    },
    set: controller.set,
  };
}
