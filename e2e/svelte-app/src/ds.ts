import { createSystem, createTheme } from '@animus-ui/system';

export const theme = /* @__PURE__ */ (() =>
  createTheme()
    .addColors({
      canary: { ink: '#123456' },
    })
    .build())();

export const { system: ds } = /* @__PURE__ */ (() => createSystem().build())();
