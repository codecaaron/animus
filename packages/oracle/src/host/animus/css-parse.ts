import { AnimusAdapterError } from './errors';

/**
 * A parser for exactly one dialect: the pretty-printed CSS animus emits into
 * `manifest.sheets.*` and `manifest.component_fragments.*` (two-space indent,
 * one declaration per line, nested at-rules). It is not a CSS parser — it
 * recognises the constructs the emitter can produce and throws on everything
 * else, which is the point: the closed universe is only closed if nothing
 * silently falls out of it.
 *
 * The assembled `styles.css` is minified and is *not* parsed here; its token
 * blocks have their own targeted reader in `tokens.ts`.
 */

export interface ParsedDeclaration {
  property: string;
  value: string;
  important: boolean;
}

/**
 * One at-rule condition, already reduced to the shape `conditions.ts` turns
 * into a scenario predicate. `media-raw` is the honest escape hatch: a media
 * query the adapter cannot decompose becomes an opaque boolean dimension
 * rather than a guessed threshold.
 */
export type AtCondition =
  | { kind: 'media-min-width'; px: number }
  | { kind: 'media-feature'; feature: string; value: string }
  | {
      kind: 'container';
      name?: string;
      feature: 'min-width' | 'width>=';
      px: number;
    }
  | { kind: 'supports'; raw: string }
  | { kind: 'media-raw'; raw: string };

export interface ParsedRule {
  selector: string;
  declarations: readonly ParsedDeclaration[];
  atStack: readonly AtCondition[];
  layerPath: readonly string[];
  /** Emission index within the parsed text, monotonic and gap-free. */
  orderIndex: number;
}

export interface KeyframesBlock {
  name: string;
  layerPath: readonly string[];
  body: string;
}

export interface FontFaceBlock {
  layerPath: readonly string[];
  declarations: readonly ParsedDeclaration[];
}

/** A `@layer a, b;` statement — the declared ordering of (sub-)layers. */
export interface LayerStatement {
  layerPath: readonly string[];
  names: readonly string[];
}

export interface ParsedStylesheet {
  rules: readonly ParsedRule[];
  keyframes: readonly KeyframesBlock[];
  fontFaces: readonly FontFaceBlock[];
  layerStatements: readonly LayerStatement[];
}

const AT_NAME = /^@([A-Za-z-]+)\s*/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MEDIA_MIN_WIDTH = /^\(\s*min-width\s*:\s*(-?\d+(?:\.\d+)?)px\s*\)$/;
const MEDIA_WIDTH_GTE = /^\(\s*width\s*>=\s*(-?\d+(?:\.\d+)?)px\s*\)$/;
const MEDIA_FEATURE = /^\(\s*([A-Za-z-]+)\s*:\s*([^()]+?)\s*\)$/;
const CONTAINER_MIN_WIDTH =
  /^(?:([A-Za-z_][A-Za-z0-9_-]*)\s+)?\(\s*min-width\s*:\s*(-?\d+(?:\.\d+)?)px\s*\)$/;
const CONTAINER_WIDTH_GTE =
  /^(?:([A-Za-z_][A-Za-z0-9_-]*)\s+)?\(\s*width\s*>=\s*(-?\d+(?:\.\d+)?)px\s*\)$/;
const IMPORTANT = /!\s*important$/i;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Split a comma-separated list at top level, ignoring commas inside quotes,
 * parentheses (`:is(a, b)`) and attribute brackets.
 */
export const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && char === separator) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
};

/**
 * Parse a declaration block body. Splits on top-level `;`, then on the first
 * top-level `:` — which is what keeps `src: url(animus-asset:…)` intact, since
 * the inner colon sits inside parentheses.
 */
export const parseDeclarations = (
  body: string,
  fail: (message: string, snippet: string) => never
): ParsedDeclaration[] => {
  const declarations: ParsedDeclaration[] = [];

  for (const chunk of splitTopLevel(body, ';')) {
    const text = chunk.trim();
    if (text === '') continue;

    const halves = splitTopLevel(text, ':');
    if (halves.length < 2) {
      fail('declaration without a `:` separator', text);
    }
    const property = halves[0].trim();
    const raw = halves.slice(1).join(':').trim();
    if (property === '') fail('declaration with an empty property', text);

    const important = IMPORTANT.test(raw);
    const value = important ? raw.replace(IMPORTANT, '').trim() : raw;
    if (value === '') fail('declaration with an empty value', text);

    declarations.push({ property, value, important });
  }

  return declarations;
};

const parseMedia = (
  prelude: string,
  fail: (message: string, snippet: string) => never
): AtCondition => {
  const query = collapse(prelude);
  if (query === '') fail('`@media` with an empty query', prelude);

  const minWidth = MEDIA_MIN_WIDTH.exec(query) ?? MEDIA_WIDTH_GTE.exec(query);
  if (minWidth !== null) {
    return { kind: 'media-min-width', px: Number(minWidth[1]) };
  }

  const feature = MEDIA_FEATURE.exec(query);
  if (feature !== null) {
    return { kind: 'media-feature', feature: feature[1], value: feature[2] };
  }

  return { kind: 'media-raw', raw: query };
};

const parseContainer = (
  prelude: string,
  fail: (message: string, snippet: string) => never
): AtCondition => {
  const query = collapse(prelude);

  const minWidth = CONTAINER_MIN_WIDTH.exec(query);
  if (minWidth !== null) {
    return minWidth[1] === undefined
      ? { kind: 'container', feature: 'min-width', px: Number(minWidth[2]) }
      : {
          kind: 'container',
          name: minWidth[1],
          feature: 'min-width',
          px: Number(minWidth[2]),
        };
  }

  const gte = CONTAINER_WIDTH_GTE.exec(query);
  if (gte !== null) {
    return gte[1] === undefined
      ? { kind: 'container', feature: 'width>=', px: Number(gte[2]) }
      : {
          kind: 'container',
          name: gte[1],
          feature: 'width>=',
          px: Number(gte[2]),
        };
  }

  return fail(
    'unmodeled `@container` query — only inline-size thresholds ' +
      '(`min-width: Npx` / `width >= Npx`) are modeled',
    query
  );
};

/**
 * `text` → rules + a catalogue of the non-rule blocks.
 *
 * `sheet` names the artifact section for error messages (`base`, `variants`,
 * a component fragment id …).
 */
export const parseStylesheet = (
  text: string,
  sheet: string
): ParsedStylesheet => {
  const rules: ParsedRule[] = [];
  const keyframes: KeyframesBlock[] = [];
  const fontFaces: FontFaceBlock[] = [];
  const layerStatements: LayerStatement[] = [];

  let pos = 0;
  let orderIndex = 0;

  // Explicitly typed so TypeScript treats a call as a terminating statement —
  // that is what lets `if (x === null) fail(…)` narrow `x` afterwards.
  const fail: (
    message: string,
    snippet: string,
    construct?: string
  ) => never = (message, snippet, construct) => {
    throw new AnimusAdapterError(message, {
      layer: sheet,
      snippet,
      ...(construct === undefined ? {} : { construct }),
    });
  };

  const checkComment = (index: number): void => {
    if (text[index] === '/' && text[index + 1] === '*') {
      fail(
        'CSS comments are not part of the animus emission dialect',
        text.slice(index, index + 40),
        '/*'
      );
    }
  };

  /** Read up to the next top-level `{`, `;` or `}` and consume it. */
  const readPrelude = (): {
    text: string;
    terminator: '{' | ';' | '}' | '';
  } => {
    const start = pos;
    let depth = 0;
    let quote: string | null = null;

    while (pos < text.length) {
      const char = text[pos];
      if (quote !== null) {
        if (char === '\\') pos += 2;
        else {
          if (char === quote) quote = null;
          pos += 1;
        }
        continue;
      }
      checkComment(pos);
      if (char === '"' || char === "'") {
        quote = char;
        pos += 1;
        continue;
      }
      if (char === '(' || char === '[') depth += 1;
      else if (char === ')' || char === ']') depth -= 1;
      else if (depth === 0 && (char === '{' || char === ';' || char === '}')) {
        const prelude = text.slice(start, pos);
        pos += 1;
        return { text: prelude, terminator: char };
      }
      pos += 1;
    }

    return { text: text.slice(start), terminator: '' };
  };

  /** Read a block body assuming the opening `{` was consumed. */
  const readBody = (allowNested: boolean, context: string): string => {
    const start = pos;
    let depth = 0;
    let quote: string | null = null;

    while (pos < text.length) {
      const char = text[pos];
      if (quote !== null) {
        if (char === '\\') pos += 2;
        else {
          if (char === quote) quote = null;
          pos += 1;
        }
        continue;
      }
      checkComment(pos);
      if (char === '"' || char === "'") {
        quote = char;
        pos += 1;
        continue;
      }
      if (char === '{') {
        if (!allowNested) {
          fail(
            'nested block inside a declaration block — the animus dialect ' +
              'hoists nested rules out of their parent',
            text.slice(start, pos + 1),
            context
          );
        }
        depth += 1;
      } else if (char === '}') {
        if (depth === 0) {
          const body = text.slice(start, pos);
          pos += 1;
          return body;
        }
        depth -= 1;
      }
      pos += 1;
    }

    return fail('unterminated block', text.slice(start, start + 60), context);
  };

  const emitRule = (
    selectorList: string,
    body: string,
    atStack: readonly AtCondition[],
    layerPath: readonly string[]
  ): void => {
    const declarations = parseDeclarations(body, (message, snippet) =>
      fail(message, snippet, selectorList.trim())
    );

    for (const part of splitTopLevel(selectorList, ',')) {
      const selector = collapse(part);
      if (selector === '') fail('empty selector in a selector list', part);
      rules.push({
        selector,
        declarations,
        atStack,
        layerPath,
        orderIndex,
      });
      orderIndex += 1;
    }
  };

  const parseBlock = (
    atStack: readonly AtCondition[],
    layerPath: readonly string[],
    nested: boolean
  ): void => {
    for (;;) {
      const { text: prelude, terminator } = readPrelude();
      const head = prelude.trim();

      if (terminator === '') {
        if (head !== '') fail('trailing text with no block or statement', head);
        if (nested) fail('unterminated `{` block', head);
        return;
      }

      if (terminator === '}') {
        if (head !== '') fail('text before `}` with no block', head);
        if (!nested) fail('stray `}`', prelude);
        return;
      }

      if (terminator === ';') {
        if (head === '') continue;
        const at = AT_NAME.exec(head);
        if (at !== null && at[1] === 'layer') {
          layerStatements.push({
            layerPath,
            names: splitTopLevel(head.slice(at[0].length), ',').map((name) =>
              name.trim()
            ),
          });
          continue;
        }
        fail('unmodeled statement', head, at === null ? head : `@${at[1]}`);
      }

      if (head.startsWith('@')) {
        const at = AT_NAME.exec(head);
        if (at === null) fail('malformed at-rule', head);
        const name = at[1];
        const rest = head.slice(at[0].length).trim();

        if (name === 'layer') {
          if (!IDENT.test(rest)) {
            fail('`@layer` block with a non-identifier name', head, '@layer');
          }
          parseBlock(atStack, [...layerPath, rest], true);
          continue;
        }
        if (name === 'media') {
          parseBlock([...atStack, parseMedia(rest, fail)], layerPath, true);
          continue;
        }
        if (name === 'container') {
          parseBlock([...atStack, parseContainer(rest, fail)], layerPath, true);
          continue;
        }
        if (name === 'supports') {
          const raw = collapse(rest);
          if (raw === '') fail('`@supports` with an empty condition', head);
          parseBlock([...atStack, { kind: 'supports', raw }], layerPath, true);
          continue;
        }
        if (name === 'keyframes') {
          keyframes.push({
            name: rest,
            layerPath,
            body: readBody(true, '@keyframes'),
          });
          continue;
        }
        if (name === 'font-face') {
          const body = readBody(false, '@font-face');
          fontFaces.push({
            layerPath,
            declarations: parseDeclarations(body, (message, snippet) =>
              fail(message, snippet, '@font-face')
            ),
          });
          continue;
        }

        fail(
          `unmodeled at-rule \`@${name}\` — the adapter models @media, ` +
            '@container, @supports and @layer, and catalogues @keyframes ' +
            'and @font-face',
          head,
          `@${name}`
        );
      }

      if (head === '') fail('block with an empty selector', prelude);
      emitRule(head, readBody(false, head), atStack, layerPath);
    }
  };

  parseBlock([], [], false);

  return { rules, keyframes, fontFaces, layerStatements };
};
