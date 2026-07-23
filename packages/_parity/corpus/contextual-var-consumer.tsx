// Corpus fixture (modern-css-surface inc 08) — blessed into the committed oracle.
// Registered-@property contextual-var pattern, COMPONENT side. The corpus
// theme (packages/extract/tests/test-system.ts) declares the contextual var
// `background-current` (colors scale); the `bg` prop carries
// `currentVar: '--current-bg'`, so a component that sets `bg` writes the
// contextual custom property that the theme's `@property` registration types.
// This unit pins the resolver's contextual-var emission path; the `@property`
// RULE itself is a theme-build artifact (createTheme variableCss) proven by the
// showcase assert-lane @property pin (inc 08) + inc-07 unit tests; the Rust
// oracle pins the component-side consumption below.
import { ds } from '../test-system';

export const ContextualCard = ds
  .styles({
    bg: 'background-current',
    p: 8,
    // A child slot inside a container reading the same contextual var by
    // var() reference — the portable form a foreign theme also honors.
    '@container card (min-width: 400px)': {
      borderTopColor: 'var(--current-bg)',
      borderTopStyle: 'solid',
      borderTopWidth: '1px',
    },
  })
  .asElement('div');
export const App = () => <ContextualCard />;
