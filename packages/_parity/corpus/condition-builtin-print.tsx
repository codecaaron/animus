// Corpus fixture (modern-css-surface inc 06) — blessed into the committed oracle.
// Built-in print condition alias `_print` (design D8) — resolves to
// `@media print` through the shipped built-in set, no user registration.
// Spec: media-condition-aliases §"Built-in media-feature condition aliases" —
// scenario "Built-in print alias".
import { ds } from '../test-system';

export const PrintCard = ds
  .styles({
    display: 'block',
    _print: { display: 'none' },
  })
  .asElement('div');
export const App = () => <PrintCard />;
