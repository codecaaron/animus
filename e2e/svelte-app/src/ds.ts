import { createSystem, createTheme } from '@animus-ui/system';

export const theme = /* @__PURE__ */ (() =>
  createTheme()
    .addColors({
      canary: { ink: '#123456' },
    })
    .build())();

// Sealed system (vocabulary-registration): a vocabulary-free system seals
// too — `.seal()` is the loader's contract for every consumer.
export const ds = /* @__PURE__ */ (() => createSystem().build().seal())();
