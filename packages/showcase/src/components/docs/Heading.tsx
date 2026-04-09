import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';

import { ds } from '../../ds';

// ─── Styled Elements ─────────────────────────────────────────────

const HeadingWrapper = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    position: 'relative',
    _hover: {
      '& [data-anchor]': {
        opacity: '0.5',
      },
    },
  })
  .asElement('div');

const HeadingBase = ds
  .styles({
    fontFamily: 'display',
    fontWeight: 500,
    letterSpacing: '-0.01em',
    color: 'text',
    m: 0,
    position: 'relative',
    scrollMarginTop: 'calc({sizes.navHeight} + 16px)',
    cursor: 'pointer',
  })
  .variant({
    prop: 'as',
    defaultVariant: 'h2',
    variants: {
      h1: { fontSize: 24, mt: 0, mb: 8 },
      h2: { fontSize: 20, mt: 32, mb: 16 },
      h3: { fontSize: 16, color: 'text.muted', mt: 32, mb: 12 },
      h4: { fontSize: 14, color: 'text.muted', mt: 24, mb: 8 },
    },
  })
  .system({ space: true })
  .asElement('h2');

const AnchorButton = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    p: 0,
    ml: 8,
    opacity: '0',
    transition: 'opacity 0.15s ease, color 0.15s ease',
    color: 'text.dim',
    _focusVisible: {
      outline: '2px solid {colors.scheme.300}',
      outlineOffset: '2px',
      opacity: '0.5',
    },
  })
  .states({
    copied: {
      opacity: '0.6',
      color: '{colors.forest.500}',
    },
  })
  .asElement('button');

// ─── Helpers ─────────────────────────────────────────────────────

function toKebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText(
      (children as { props: { children?: ReactNode } }).props.children
    );
  }
  return '';
}

// ─── Icons ───────────────────────────────────────────────────────

const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path
      d="M6.5 3.5h-2a2 2 0 000 4h2m3-4h2a2 2 0 010 4h-2m-5-2h6"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      fill="none"
      transform="translate(0,2.5)"
    />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path
      d="M3 8.5l3 3 7-7"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── Component ───────────────────────────────────────────────────

type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4';

type HeadingProps = Omit<ComponentProps<typeof HeadingBase>, 'as'> & {
  as?: HeadingElement;
};

export function Heading({
  as: element = 'h2',
  children,
  ...props
}: HeadingProps) {
  const id = toKebab(extractText(children));
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(`#${id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [id]);

  return (
    <HeadingWrapper style={{ margin: 0 }}>
      <HeadingBase id={id} as={element} {...props}>
        {children}
      </HeadingBase>
      <AnchorButton
        type="button"
        data-anchor
        copied={copied}
        onClick={handleCopy}
        aria-label={`Copy link to ${extractText(children)}`}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </AnchorButton>
    </HeadingWrapper>
  );
}
