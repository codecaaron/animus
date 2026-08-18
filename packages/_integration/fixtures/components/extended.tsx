import { Button } from './button';

// Cross-file extension chain: the one fixture that populates
// `extends_from` / `reverse_provenance`, so the provenance-reciprocity
// tests in manifest-shape.test.ts iterate a non-empty collection.
export const OutlineButton = Button.extend()
  .styles({
    border: '1px solid',
    borderColor: 'primary',
    bg: 'transparent',
  })
  .asElement('button');

export const App = () => <OutlineButton size="small" intent="primary" />;
