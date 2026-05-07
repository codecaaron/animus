import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useState,
} from 'react';

import { Check, Link } from 'lucide-react';

import { ds } from '../../ds';

// ─── Styled Elements ─────────────────────────────────────────────

const HeadingWrapper = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    m: 0,
    position: 'relative',
    '&:hover [data-anchor]': {
      opacity: '0.5',
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
      color: 'forest.500',
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
    <HeadingWrapper>
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
        {copied ? <Check size={16} /> : <Link size={16} />}
      </AnchorButton>
    </HeadingWrapper>
  );
}
