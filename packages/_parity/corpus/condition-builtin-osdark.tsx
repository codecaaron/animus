// Corpus fixture (modern-css-surface inc 06) — blessed into the committed oracle.
// Built-in OS color-scheme condition alias `_osDark` (design D8) — resolves to
// `@media (prefers-color-scheme: dark)` through the shipped built-in set, no
// user registration.
// Spec: media-condition-aliases §"Built-in media-feature condition aliases" —
// scenario "Built-in OS color-scheme alias".
import { ds } from '../test-system';

export const OsDarkCard = ds
  .styles({
    display: 'flex',
    _osDark: { colorScheme: 'dark' },
  })
  .asElement('div');
export const App = () => <OsDarkCard />;
