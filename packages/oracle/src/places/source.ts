import { parseSync } from 'oxc-parser';

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

interface AstNode {
  type?: unknown;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null;

const spanOf = (node: AstNode): readonly [number, number] => [
  typeof node.start === 'number' ? node.start : 0,
  typeof node.end === 'number' ? node.end : 0,
];

/** `<A.B.C>` → 'A.B.C'; identifiers pass through; anything else ''. */
const tagNameOf = (name: unknown): string => {
  if (!isNode(name)) return '';
  if (name.type === 'JSXIdentifier') return String(name.name ?? '');
  if (name.type === 'JSXMemberExpression') {
    return `${tagNameOf(name.object)}.${tagNameOf(name.property)}`;
  }
  if (name.type === 'JSXNamespacedName') {
    return `${tagNameOf(name.namespace)}:${tagNameOf(name.name)}`;
  }
  return '';
};

const isComponentTag = (tag: string): boolean =>
  tag.includes('.') || /^[A-Z]/.test(tag);

const staticAttrValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return 'true';
  if (!isNode(value)) return undefined;
  if (value.type === 'Literal' && typeof value.value === 'string') {
    return value.value;
  }
  if (value.type === 'JSXExpressionContainer') {
    const expression = value.expression;
    if (
      isNode(expression) &&
      expression.type === 'Literal' &&
      (typeof expression.value === 'string' ||
        typeof expression.value === 'number')
    ) {
      return String(expression.value);
    }
    return undefined;
  }
  return undefined;
};

const attributesOf = (
  opening: AstNode
): { attributes: SourceAttribute[]; hasSpread: boolean } => {
  const attributes: SourceAttribute[] = [];
  let hasSpread = false;

  const list = Array.isArray(opening.attributes) ? opening.attributes : [];
  for (const attr of list) {
    if (!isNode(attr)) continue;
    if (attr.type === 'JSXSpreadAttribute') {
      hasSpread = true;
      attributes.push({ name: '...', kind: 'spread', span: spanOf(attr) });
      continue;
    }
    if (attr.type !== 'JSXAttribute') continue;
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

  const visit = (node: unknown, parent: number | undefined): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent);
      return;
    }
    if (!isNode(node)) return;

    if (node.type === 'JSXElement') {
      const opening = isNode(node.openingElement) ? node.openingElement : {};
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
        parent,
      });
      // Attribute values first (matching visit order), containment severed —
      // a render prop's JSX is not a DOM child of this element.
      for (const attr of Array.isArray(opening.attributes)
        ? opening.attributes
        : []) {
        if (isNode(attr)) visit(attr.value ?? attr.argument, undefined);
      }
      visit(node.children, ordinal);
      return;
    }
    if (node.type === 'JSXFragment') {
      visit(node.children, parent);
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      visit(node[key], parent);
    }
  };

  visit(parsed.program, undefined);
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
