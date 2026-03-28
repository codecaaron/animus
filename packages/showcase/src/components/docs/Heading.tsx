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
    prop: 'level',
    variants: {
      1: {},
      2: { fontSize: 20, mt: 48, mb: 16 },
      3: { fontSize: 16, color: 'text-muted', mt: 32, mb: 12 },
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

type HeadingProps = Omit<ComponentProps<typeof HeadingBase>, 'level'> & {
  level?: 2 | 3;
};

export function Heading({ level = 2, children, ...props }: HeadingProps) {
  const id = toKebab(extractText(children));
  const element = level === 3 ? 'h3' : 'h2';

  return (
    <HeadingBase
      id={id}
      level={String(level) as '2' | '3'}
      as={element}
      {...props}
    >
      {children}
    </HeadingBase>
  );
}
