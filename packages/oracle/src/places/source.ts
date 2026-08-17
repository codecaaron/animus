import { parseSync, Visitor } from 'oxc-parser';

import type {
  Expression,
  JSXAttributeValue,
  JSXElementName,
  JSXOpeningElement,
  Span,
} from 'oxc-parser';

/**
 * Seam S5 (PLACES.md §1): the structural reader — the only new reader the
 * places layer adds, and deliberately the weakest authority. It reads JSX
 * *structure* from authored source: which elements exist, their spans, their
 * statically-knowable attributes, and which element contains which. It never
 * interprets a style, a token, or a class name; every styling conclusion
 * still flows through the extraction artifacts and the cascade.
 *
 * Spans are byte offsets into the file, matching the manifest's span
 * convention (`usageResidue`, `argSpan`).
 */

export interface SourceAttribute {
  name: string;
  kind: 'static' | 'dynamic' | 'spread';
  /** Present only for `static`. A bare JSX attribute reads as 'true'. */
  value?: string;
  span: readonly [number, number];
}

export interface SourceElement {
  /** Index in source (pre-)order over every JSX element in the file. */
  ordinal: number;
  /** `div`, `GroupItem`, `Root.Slot`. */
  tag: string;
  /** Component-like tag — a boundary the structural reader cannot cross. */
  component: boolean;
  attributes: readonly SourceAttribute[];
  hasSpread: boolean;
  span: readonly [number, number];
  /**
   * Ordinal of the containing JSX element, or undefined at a structural
   * root. JSX reached through an attribute value (a render prop) has no
   * parent on purpose: it is not a DOM child of the element that carries it.
   * Fragments and expression containers pass containment through.
   */
  parent: number | undefined;
}

export interface SourceRead {
  file: string;
  elements: readonly SourceElement[];
}

/**
 * ESTree collapses every literal onto one `type: 'Literal'`, so the kind is
 * not in the tag. It discriminates the two kinds JSON cannot carry with their
 * own fields (`bigint`, `regex`) — the seam this reader narrows on.
 */
type LiteralExpression = Extract<Expression, { type: 'Literal' }>;

const spanOf = (node: Span): readonly [number, number] => [
  node.start,
  node.end,
];

/** `<A.B.C>` → 'A.B.C'; identifiers pass through. */
const tagNameOf = (name: JSXElementName): string => {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    return `${tagNameOf(name.object)}.${tagNameOf(name.property)}`;
  }
  return `${tagNameOf(name.namespace)}:${tagNameOf(name.name)}`;
};

const isComponentTag = (tag: string): boolean =>
  tag.includes('.') || /^[A-Z]/.test(tag);

/**
 * A `{...}` attribute value the reader can write down: string and number
 * literals only. A boolean, null, bigint or regexp literal is a value the
 * structural reader has no attribute text for, so it reads as dynamic.
 */
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

/**
 * Read one file's JSX structure. Throws only on unparseable source — an
 * unreadable file is not a degraded structure, it is a different program
 * than the one being asked about.
 */
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
    // OXC reaches an attribute before this element's children, matching the
    // reader's order — but containment is severed across it: a render prop's
    // JSX is not a DOM child of the element that carries it.
    JSXAttribute: sever,
    'JSXAttribute:exit': restore,
    JSXSpreadAttribute: sever,
    'JSXSpreadAttribute:exit': restore,
  }).visit(parsed.program);

  return { file, elements };
};

/** The ancestor chain of one element, innermost first. */
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
