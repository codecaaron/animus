import { componentValues, tokenize } from '@animus-ui/properties';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzipSync } from 'node:zlib';

import type { ComponentValue } from '@animus-ui/properties';

/** One selector of a style rule's list, where it is written. */
export interface SheetSelector {
  text: string;
  start: number;
  end: number;
  /** The classes an element must carry to match it: each written outside a
   *  pseudo-class's argument, and, for a nested rule, those every selector
   *  of the rule it nests in needs. */
  classes: string[];
  /** Every class it names, inside a function's argument too (`:is(.a)`,
   *  `:not(.b)`): what it says about which classes a build emits. */
  named: string[];
}

/** A style rule, or an at-rule with a block (`@media`, `@layer`, …). */
export type SheetNode =
  | {
      type: 'style';
      start: number;
      end: number;
      selectors: SheetSelector[];
      /** Its declarations as written, `property:value`, trimmed. */
      declarations: string[];
      /** The at-rules it sits in, outermost first (`@layer anm-base`). */
      context: string[];
      children: SheetNode[];
    }
  | {
      type: 'at';
      name: string;
      prelude: string;
      start: number;
      end: number;
      /** Declarations it holds directly (`@font-face`, or one nested in a
       *  style rule, whose declarations apply to that rule's selectors), so
       *  it never goes on its own. */
      declarations: string[];
      children: SheetNode[];
    };

const isBlock = (
  value: ComponentValue
): value is Extract<ComponentValue, { kind: 'block' }> =>
  value.kind === 'block';

const isToken = (value: ComponentValue, type: string): boolean =>
  value.kind === 'token' && value.token.type === type;

/** The values without leading and trailing whitespace. */
function trimmed(values: ComponentValue[]): ComponentValue[] {
  let from = 0;
  let to = values.length;
  while (from < to && isToken(values[from]!, 'whitespace')) from++;
  while (to > from && isToken(values[to - 1]!, 'whitespace')) to--;
  return values.slice(from, to);
}

/** The classes `values` names outside any function's or block's argument:
 *  a `.` delim followed at once by an identifier. */
function ownClasses(values: ComponentValue[]): string[] {
  const classes: string[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    const dot = values[i]!;
    const name = values[i + 1]!;
    if (
      dot.kind === 'token' &&
      dot.token.type === 'delim' &&
      dot.token.value === '.' &&
      name.kind === 'token' &&
      name.token.type === 'ident' &&
      name.start === dot.end
    ) {
      classes.push(name.token.value);
    }
  }
  return classes;
}

/** Every class `values` names, inside a function's or bracket's argument
 *  too. */
function namedClasses(values: ComponentValue[]): string[] {
  return [
    ...ownClasses(values),
    ...values.flatMap((value) =>
      isBlock(value) && value.open.type !== '{'
        ? namedClasses(value.children)
        : []
    ),
  ];
}

/** Whether a nested selector stands inside its parent: it writes `&`
 *  outside an argument, or no `&` at all. */
function nestsInParent(
  values: ComponentValue[],
  css: string,
  start: number,
  end: number
): boolean {
  const own = values.some(
    (value) =>
      value.kind === 'token' &&
      value.token.type === 'delim' &&
      value.token.value === '&'
  );
  return own || !css.slice(start, end).includes('&');
}

/** The selectors of a prelude, split at its top-level commas. */
function selectorsOf(
  css: string,
  prelude: ComponentValue[],
  parent: readonly string[] | null
): SheetSelector[] {
  const selectors: SheetSelector[] = [];
  let part: ComponentValue[] = [];
  const flush = () => {
    const values = trimmed(part);
    part = [];
    if (values.length === 0) return;
    const start = values[0]!.start;
    const end = values[values.length - 1]!.end;
    const classes = ownClasses(values);
    if (parent !== null && nestsInParent(values, css, start, end)) {
      classes.push(...parent);
    }
    selectors.push({
      text: css.slice(start, end),
      start,
      end,
      classes,
      named: namedClasses(values),
    });
  };
  for (const value of prelude) {
    if (isToken(value, ',')) flush();
    else part.push(value);
  }
  flush();
  return selectors;
}

/** The classes every selector of a list needs. */
function commonClasses(selectors: SheetSelector[]): string[] {
  const [first, ...rest] = selectors;
  if (first === undefined) return [];
  return first.classes.filter((name) =>
    rest.every((selector) => selector.classes.includes(name))
  );
}

/** What a block holds: its declarations and the rules in it. */
interface RuleBody {
  declarations: string[];
  children: SheetNode[];
}

/**
 * The declarations and rules of a list of values: the sheet's, or a
 * block's. A nested rule's selectors stand inside `parent`, the classes the
 * enclosing style rule's selectors all need; `null` outside any style rule.
 */
function ruleBody(
  css: string,
  values: ComponentValue[],
  context: string[],
  parent: readonly string[] | null
): RuleBody {
  const declarations: string[] = [];
  const children: SheetNode[] = [];
  let part: ComponentValue[] = [];
  const flush = () => {
    const segment = trimmed(part);
    part = [];
    if (segment.length === 0) return;
    declarations.push(
      css.slice(segment[0]!.start, segment[segment.length - 1]!.end)
    );
  };
  for (const value of values) {
    if (isToken(value, ';')) {
      flush();
    } else if (isBlock(value) && value.open.type === '{') {
      const head = trimmed(part);
      part = [];
      const first = head[0];
      if (first === undefined) continue;
      if (first.kind === 'token' && first.token.type === 'at-keyword') {
        const name = first.token.value.toLowerCase();
        const text = css.slice(first.end, value.start).trim();
        const inner = [...context, `@${name} ${text}`];
        children.push({
          type: 'at',
          name,
          prelude: text,
          start: first.start,
          end: value.end,
          ...ruleBody(css, value.children, inner, parent),
        });
      } else {
        const selectors = selectorsOf(css, head, parent);
        children.push({
          type: 'style',
          start: first.start,
          end: value.end,
          selectors,
          context,
          ...ruleBody(css, value.children, context, commonClasses(selectors)),
        });
      }
    } else {
      part.push(value);
    }
  }
  flush();
  return { declarations, children };
}

/** A parsed style sheet: its text and its rules. */
export interface Sheet {
  css: string;
  rules: SheetNode[];
}

export function parseSheet(css: string): Sheet {
  return {
    css,
    rules: ruleBody(css, componentValues(tokenize(css)), [], null).children,
  };
}

/** Adds to `into` each class the selectors of `nodes`' style rules name,
 *  nested ones too, of the rules `keep` admits. */
export function addSelectedClasses(
  nodes: readonly SheetNode[],
  into: Set<string>,
  keep: (rule: Extract<SheetNode, { type: 'style' }>) => boolean = () => true
): Set<string> {
  eachStyleRule(nodes, (rule) => {
    if (!keep(rule)) return;
    for (const selector of rule.selectors) {
      for (const name of selector.classes) into.add(name);
    }
  });
  return into;
}

/** Adds to `into` each class the selectors of `nodes`' style rules name
 *  anywhere, inside a function's argument too, nested rules included, of
 *  the rules `keep` admits. */
export function addNamedClasses(
  nodes: readonly SheetNode[],
  into: Set<string>,
  keep: (rule: Extract<SheetNode, { type: 'style' }>) => boolean = () => true
): Set<string> {
  eachStyleRule(nodes, (rule) => {
    if (!keep(rule)) return;
    for (const selector of rule.selectors) {
      for (const name of selector.named) into.add(name);
    }
  });
  return into;
}

/** Calls `visit` with every style rule of `nodes`, nested ones too. */
export function eachStyleRule(
  nodes: readonly SheetNode[],
  visit: (rule: Extract<SheetNode, { type: 'style' }>) => void
): void {
  for (const node of nodes) {
    if (node.type === 'style') visit(node);
    eachStyleRule(node.children, visit);
  }
}

/** Cuts each run of dead selectors from a list some of which live: a run
 *  before a live selector with the comma after it, a run ending the list
 *  with the comma before it. */
function cutSelectors(
  selectors: SheetSelector[],
  dead: boolean[],
  cuts: Array<[number, number]>
): void {
  if (!dead.some(Boolean) || dead.every(Boolean)) return;
  for (let a = 0; a < dead.length; a++) {
    if (!dead[a]) continue;
    let b = a;
    while (b + 1 < dead.length && dead[b + 1]) b++;
    cuts.push(
      b + 1 < selectors.length
        ? [selectors[a]!.start, selectors[b + 1]!.start]
        : [selectors[a - 1]!.end, selectors[b]!.end]
    );
    a = b;
  }
}

/** The at-rules a removal that empties them takes with it: one that only
 *  conditions its rules. An emptied `@layer` block stays, since it still
 *  places its layer in the layer order. */
const CONDITIONAL_AT_RULES = new Set(['media', 'supports', 'container']);

/**
 * The sheet's text without each selector `drop` returns true for: a style
 * rule loses those selectors from its list, and goes whole when it loses
 * them all and every rule nested in it goes too; an `@media`, `@supports`
 * or `@container` rule that loses every rule goes too. What stays is cut
 * from the text, never reprinted, so it is byte for byte what was shipped.
 * `null` when nothing goes.
 */
export function withoutSelectors(
  sheet: Sheet,
  drop: (
    selector: SheetSelector,
    rule: Extract<SheetNode, { type: 'style' }>
  ) => boolean,
  dropAt: (rule: Extract<SheetNode, { type: 'at' }>) => boolean = () => false
): string | null {
  const { css } = sheet;
  const cuts: Array<[number, number]> = [];
  // Whether `node` goes whole; otherwise its own cuts are recorded.
  const goes = (node: SheetNode): boolean => {
    if (node.type === 'at' && dropAt(node)) return true;
    const gone = node.children.filter(goes);
    const emptied = gone.length === node.children.length;
    if (node.type === 'at') {
      if (
        emptied &&
        gone.length > 0 &&
        node.declarations.length === 0 &&
        CONDITIONAL_AT_RULES.has(node.name)
      ) {
        return true;
      }
    } else {
      const dead = node.selectors.map((selector) => drop(selector, node));
      if (dead.every(Boolean) && emptied) return true;
      cutSelectors(node.selectors, dead, cuts);
    }
    for (const child of gone) cuts.push([child.start, child.end]);
    return false;
  };
  for (const node of sheet.rules) {
    if (goes(node)) cuts.push([node.start, node.end]);
  }
  if (cuts.length === 0) return null;
  cuts.sort((a, b) => a[0] - b[0]);
  let text = '';
  let from = 0;
  for (const [start, end] of cuts) {
    if (start < from) continue;
    text += css.slice(from, start);
    from = end;
  }
  return text + css.slice(from);
}

/** A text's size as shipped: raw bytes, gzip level 9, and Brotli quality 11
 *  with a 22-bit window, each file compressed on its own. */
export interface Sizes {
  raw: number;
  gzip: number;
  brotli: number;
}

export function gzipSize(text: string): number {
  return gzipSync(Buffer.from(text), { level: 9 }).length;
}

const brotli = promisify(brotliCompress);

/** Off the main thread, so several run at once on libuv's pool. */
export async function brotliSize(text: string): Promise<number> {
  const bytes = Buffer.from(text);
  const compressed = await brotli(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 22,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
  return compressed.length;
}
