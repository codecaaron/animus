import type { ComponentProps, ReactNode } from 'react';

import { ds } from '../../ds';

const HeadingBase = ds
  .styles({
    fontFamily: 'display',
    fontWeight: 500,
    letterSpacing: '-0.01em',
    color: 'text',
    m: 0,
    position: 'relative',
  })
  .variant({
    prop: 'as',
    defaultVariant: 'h2',
    variants: {
      h1: { fontSize: 28, mt: 0, mb: 24 },
      h2: { fontSize: 20, mt: 48, mb: 16 },
      h3: { fontSize: 16, color: 'text-muted', mt: 32, mb: 12 },
      h4: { fontSize: 14, color: 'text-muted', mt: 24, mb: 8 },
    },
  })
  .groups({ space: true })
  .asElement('h2');

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

type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4';

type HeadingProps = Omit<ComponentProps<typeof HeadingBase>, 'as'> & {
  as?: HeadingElement;
};

export function Heading({ as: element = 'h2', children, ...props }: HeadingProps) {
  const id = toKebab(extractText(children));

  return (
    <HeadingBase id={id} as={element} {...props}>
      {children}
    </HeadingBase>
  );
}
