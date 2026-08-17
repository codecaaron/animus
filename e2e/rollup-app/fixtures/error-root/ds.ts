// Error-kind fixture system (inc 03 recorded gap, landed with inc 05):
// the `badGlow` transform returns an OBJECT — the invalid result shape
// the engine escalates to a `kind: "error"` manifest diagnostic, which
// fails the build in every mode (extraction-diagnostics § Error
// diagnostics fail the build). `createTransform` captures the source so
// the sandbox actually evaluates it (a bare arrow would degrade to the
// warn-and-fallback path instead).
import { createSystem, createTheme, createTransform } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5' } })
  .build();

const badGlow = createTransform('badGlow', (value) => ({
  boxShadow: String(value),
}));

export const { system: ds } = createSystem()
  .addGroup('fx', {
    glow: {
      property: 'boxShadow',
      transform: badGlow,
    },
  })
  .build(theme);
