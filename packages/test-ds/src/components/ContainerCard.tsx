import { compose } from '@animus-ui/system';

import { ds } from '../system';

// Canonical compose-slot CONTAINER pattern (modern-css-surface inc 08,
// cross-cutting 2.1). The Root slot ESTABLISHES a named query container
// (`container-name: card; container-type: inline-size` — design D7, plain
// pass-through declarations), and slotted children RESPOND to it via raw
// `@container card (…)` block keys. Raw at-rule keys need no registration, so
// this family emits its container CSS through ANY extracting system (portable
// across the consumer lanes — design D2 / inc-03 portability datum).
//
// The `Media` slot references the theme-registered `@property --current-bg`
// contextual var by `var(--current-bg)` (design D6). The registration lives in
// the CONSUMING app's theme (e.g. showcase `ds.ts` registers `current-bg` with
// `{ syntax, inherits, initialValue }`), so the family is the first end-to-end
// consumer that exercises a registered contextual var through the full NAPI
// pipeline (the owed inc-07 V9 obligation).

const ContainerCardRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    p: 16,
    borderRadius: '8px',
    bg: 'surface',
    color: 'text',
    // Container establishment — ordinary declarations, emitted verbatim in the
    // base rule (design D7). No dedicated establishment API.
    containerType: 'inline-size',
    containerName: 'card',
  })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: {
      md: {},
      lg: { p: 24 },
    },
  })
  .asElement('article');

const ContainerCardMedia = ds
  .styles({
    display: 'block',
    width: '100%',
    minHeight: '64px',
    borderRadius: '4px',
    // Consume the registered @property contextual var by var() reference —
    // a pass-through value, emitted verbatim, portable to any theme that
    // registers `--current-bg`.
    background: 'var(--current-bg)',
    // Respond to the named container: at >= 400px inline-size the media grows
    // and switches to a container-relative width (design D11 unit transit).
    '@container card (min-width: 400px)': {
      minHeight: '120px',
      width: '50cqw',
    },
  })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: {
      md: {},
      lg: {},
    },
  })
  .asElement('div');

const ContainerCardBody = ds
  .styles({
    fontSize: 14,
    lineHeight: '1.5',
    color: 'text',
    // A second slot responding to the same container — proves multiple
    // children key off one Root-established container.
    '@container card (min-width: 400px)': {
      fontSize: 16,
    },
  })
  .asElement('div');

export const ContainerCard = compose(
  {
    Root: ContainerCardRoot,
    Media: ContainerCardMedia,
    Body: ContainerCardBody,
  },
  { shared: { size: true }, name: 'ContainerCard' }
);
