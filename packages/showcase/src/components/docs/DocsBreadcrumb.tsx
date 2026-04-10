import { ds } from '../../ds';

// ─── DocsBreadcrumb ──────────────────────────────────────────────
//
// Mobile-only sticky breadcrumb bar. Pure structure — no hooks,
// no client deps. Section/page resolved by caller from DOCS_NAV.
// RSC-safe: onClick is the only interactive prop, isolated to the
// client boundary that renders this component.

const BreadcrumbBar = ds
  .styles({
    position: 'sticky',
    top: '{sizes.navHeight}',
    zIndex: '99',
    display: { _: 'flex', sm: 'none' },
    alignItems: 'center',
    gap: 6,
    width: '100%',
    px: 24,
    py: 8,
    bg: 'bg',
    borderBottom: 1,
    borderColor: 'border',
    cursor: 'pointer',
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    transition: 'color 0.15s ease',
    border: 'none',
    textAlign: 'left',
    '&:hover': { color: 'text.muted' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '-2px',
    },
  })
  .asElement('button');

const Separator = ds
  .styles({
    color: 'text.dim',
    userSelect: 'none',
  })
  .asElement('span');

interface DocsBreadcrumbProps {
  section?: string;
  page?: string;
  onClick?: () => void;
}

export function DocsBreadcrumb({
  section,
  page,
  onClick,
}: DocsBreadcrumbProps) {
  if (!section) return null;

  return (
    <BreadcrumbBar onClick={onClick} aria-label="Open navigation" type="button">
      {section}
      {page && (
        <>
          <Separator aria-hidden="true">›</Separator>
          {page}
        </>
      )}
    </BreadcrumbBar>
  );
}
