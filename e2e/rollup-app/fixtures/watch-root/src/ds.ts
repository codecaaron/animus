// Watch-lane fixture system (openspec: standalone-extraction-cli inc 06).
// Valid at rest; the `glow` prop's transform returns an OBJECT — the
// invalid result shape the engine escalates to a `kind: "error"` manifest
// diagnostic ON USE (same mechanism as fixtures/error-root). The watch
// scenario flips one COMPONENT edit between healthy (no glow) and failing
// (glow used) to witness keep-last-good per-cycle reporting without
// touching the system file mid-run. `createTransform` captures the source
// so the sandbox actually evaluates it.
import { createSystem, createTheme, createTransform } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5', 700: '#404040' } })
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
