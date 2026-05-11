import { compose } from '@animus-ui/system';

import { ds } from '../../ds';

// ─── NavBar Slot Definitions ──────────────────────────────────────
//
// Single tree, always rendered. Responsive display values inside the
// `inline` variant toggle Links/MobileTrigger visibility at md.
// No wrapper div needed — NavBarRoot stays sticky.

const NavBarRoot = ds
  .styles({
    position: 'sticky',
    top: '0',
    zIndex: '100',
    py: 12,
    bg: 'bg',
    borderBottom: 1,
    borderColor: 'border',
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: {},
      compact: {},
    },
  })
  .asElement('nav');

const NavBarContainer = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    maxWidth: '1440px',
    width: '100%',
    mx: 'auto',
    px: 24,
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: { gap: { _: 12, md: 24 } },
      compact: { gap: 12 },
    },
  })
  .asElement('div');

const NavBarBrand = ds
  .styles({
    fontFamily: 'logo',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '2px',
    color: 'primary',
    textDecoration: 'none',
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: {},
      compact: {},
    },
  })
  .asElement('span');

const NavBarLinks = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: {},
      compact: { display: 'none' },
    },
  })
  .asElement('div');

const NavBarActions = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: {},
      compact: {},
    },
  })
  .asElement('div');

const NavBarMobileTrigger = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 16,
    fontWeight: 700,
    color: 'primary',
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    p: 0,
    lineHeight: 'none',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'text' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '2px',
    },
  })
  .variant({
    prop: 'mode',
    defaultVariant: 'inline',
    variants: {
      inline: { display: { _: 'inline-flex', md: 'none' } },
      compact: { display: 'inline-flex' },
    },
  })
  .asElement('button');

export const NavBar = compose(
  {
    Root: NavBarRoot,
    Container: NavBarContainer,
    Brand: NavBarBrand,
    Links: NavBarLinks,
    Actions: NavBarActions,
    MobileTrigger: NavBarMobileTrigger,
  },
  { shared: { mode: true } }
);

// ─── NavItem ──────────────────────────────────────────────────────

export const NavItem = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
    '&:hover': { color: 'text.muted' },
    '&.active': { color: 'primary' },
  })
  .asElement('a');

// ─── NavDivider ───────────────────────────────────────────────────

export const NavDivider = ds
  .styles({
    width: '1px',
    height: '16px',
    bg: 'border',
  })
  .asElement('div');
