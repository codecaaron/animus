import { afterEach, expect, it, vi } from 'vitest';

import { createColorModeController } from '../src/appearance/controller';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Theme families user story 49: the light/dark kit stores nothing unless
// storage is enabled.
it('writes nothing to localStorage when storage is not enabled', () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem,
    removeItem: vi.fn(),
  });

  const controller = createColorModeController({ modes: ['dark', 'light'] });
  controller.set('dark');
  controller.set('system');

  expect(setItem).not.toHaveBeenCalled();
});
