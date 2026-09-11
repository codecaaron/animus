import { parseSync, Visitor } from 'oxc-parser';

import type {
  Expression,
  JSXAttributeValue,
  JSXElementName,
  JSXOpeningElement,
  Span,
} from 'oxc-parser';

export interface SourceAttribute {
  name: string;
  kind: 'static' | 'dynamic' | 'spread';
  value?: string;
  span: readonly [number, number];
}

export interface SourceElement {
  ordinal: number;
  tag: string;
  component: boolean;
  attributes: readonly SourceAttribute[];
  hasSpread: boolean;
  span: readonly [number, number];
  parent: number | undefined;
}

export interface SourceRead {
  file: string;
  elements: readonly SourceElement[];
}

type LiteralExpression = Extract<Expression, { type: 'Literal' }>;

const spanOf = (node: Span): readonly [number, number] => [
  node.start,
  node.end,
];

const tagNameOf = (name: JSXElementName): string => {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    return `${tagNameOf(name.object)}.${tagNameOf(name.property)}`;
  }
  return `${tagNameOf(name.namespace)}:${tagNameOf(name.name)}`;
};

const isComponentTag = (tag: string): boolean =>
  tag.includes('.') || /^[A-Z]/.test(tag);

const literalText = (literal: LiteralExpression): string | undefined => {
  if ('bigint' in literal || 'regex' in literal) return undefined;
  const { value } = literal;
  if (value === null || value === true || value === false) return undefined;
  return String(value);
};

const staticAttrValue = (
  value: JSXAttributeValue | null
): string | undefined => {
  if (value === null) return 'true';
  if (value.type === 'Literal') return value.value;
  if (value.type === 'JSXExpressionContainer') {
    const { expression } = value;
    return expression.type === 'Literal' ? literalText(expression) : undefined;
  }
  return undefined;
};

const attributesOf = (
  opening: JSXOpeningElement
): Pick<SourceElement, 'attributes' | 'hasSpread'> => {
  const attributes: SourceAttribute[] = [];
  let hasSpread = false;

  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      hasSpread = true;
      attributes.push({ name: '...', kind: 'spread', span: spanOf(attr) });
      continue;
    }
    const name = tagNameOf(attr.name);
    const value = staticAttrValue(attr.value);
    attributes.push({
      name,
      ...(value === undefined
        ? { kind: 'dynamic' as const }
        : { kind: 'static' as const, value }),
      span: spanOf(attr),
    });
  }

  return { attributes, hasSpread };
};

export const readSourceStructure = (file: string, text: string): SourceRead => {
  const parsed = parseSync(file, text);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      `structural read of ${file} failed to parse: ${String(
        first.message ?? first
      )}`
    );
  }

  const elements: SourceElement[] = [];
  // Innermost-last stack of the containing element for the next JSX element
  // OXC reaches. A fragment is transparent, so it pushes nothing.
  const containment: (number | undefined)[] = [undefined];
  const sever = (): void => {
    containment.push(undefined);
  };
  const restore = (): void => {
    containment.pop();
  };

  new Visitor({
    JSXElement(node) {
      const opening = node.openingElement;
      const tag = tagNameOf(opening.name);
      const { attributes, hasSpread } = attributesOf(opening);
      const ordinal = elements.length;
      elements.push({
        ordinal,
        tag,
        component: isComponentTag(tag),
        attributes,
        hasSpread,
        span: spanOf(node),
        parent: containment[containment.length - 1],
      });
      containment.push(ordinal);
    },
    'JSXElement:exit': restore,
    // OXC reaches attributes before children, so containment is severed
    // across them: a render prop's JSX is not a DOM child of its carrier.
    JSXAttribute: sever,
    'JSXAttribute:exit': restore,
    JSXSpreadAttribute: sever,
    'JSXSpreadAttribute:exit': restore,
  }).visit(parsed.program);

  return { file, elements };
};

export const ancestorsOf = (
  read: SourceRead,
  ordinal: number
): SourceElement[] => {
  const chain: SourceElement[] = [];
  let cursor = read.elements[ordinal]?.parent;
  while (cursor !== undefined) {
    const element = read.elements[cursor];
    chain.push(element);
    cursor = element.parent;
  }
  return chain;
};
