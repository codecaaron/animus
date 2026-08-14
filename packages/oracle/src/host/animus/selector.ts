import { splitTopLevel } from './css-parse';
import { MODE_SELECTOR } from './tokens';

import type {
  AncestorLink,
  SelectorModel,
} from '../../providers/style-universe';

/**
 * How much of a selector the closed model can decide from a scenario point
 * alone.
 *
 * - `class-simple` — one compound selector of classes (plus pseudo/attribute
 *   qualifiers). `TargetResolution.classes(point)` decides it outright.
 * - `element` — an element or universal selector (`body`, `*`, `:root`). It
 *   matches by tree position, not by the classes a target carries.
 * - `relational` — any combinator (descendant, `>`, `+`, `~`). The subject
 *   compound is still class-decidable; the ancestor prefix becomes a guard
 *   over the mode axis or an `ancestor:*` axis (PLACES.md §3) that only a
 *   place binding or an explicit scenario can decide.
 */
export type SelectorClassification = 'class-simple' | 'element' | 'relational';

export interface AnalyzedSelector {
  model: SelectorModel;
  classification: SelectorClassification;
}

/** Split `a, b` into one selector per record — cascade order is per selector. */
export const splitSelectorList = (raw: string): string[] =>
  splitTopLevel(raw, ',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '');

const isIdentStart = (char: string): boolean => /[A-Za-z_]/.test(char);

const isIdentChar = (char: string): boolean => /[A-Za-z0-9_-]/.test(char);

const readIdent = (raw: string, from: number): string => {
  let end = from;
  while (end < raw.length && isIdentChar(raw[end])) end += 1;
  return raw.slice(from, end);
};

type Combinator = AncestorLink['combinator'];

interface CompoundChainLink {
  compound: string;
  /** Relation between this compound and the one before it. */
  combinatorBefore: Combinator | null;
}

/**
 * Split a (comma-free, whitespace-normalized) selector into its compound
 * chain at nesting depth 0. Scanning is quote- and bracket-aware so a space
 * inside `[data-x="a b"]` or `:is(a b)` is not mistaken for a descendant
 * combinator — the same discipline the flat scan used.
 */
const splitCompoundChain = (selector: string): CompoundChainLink[] => {
  const links: CompoundChainLink[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  /** Combinator that preceded the compound currently accumulating. */
  let before: Combinator | null = null;
  /** Boundary seen after `current` but not yet owned by a next compound. */
  let boundary: Combinator | null = null;

  // Any compound-content character closes an open boundary: the accumulated
  // compound is pushed with the combinator that preceded IT, and the pending
  // boundary becomes the next compound's `before`. Attribute and quote
  // openers count as content too — `[a] [b]` is two compounds, and only the
  // generic-char path flushing would silently merge them.
  const closeBoundary = (): void => {
    if (boundary === null) return;
    if (current !== '') {
      links.push({ compound: current, combinatorBefore: before });
      before = boundary;
      current = '';
    }
    boundary = null;
  };

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (quote !== null) {
      current += char;
      if (char === '\\') {
        if (index + 1 < selector.length) current += selector[index + 1];
        index += 1;
      } else if (char === quote) quote = null;
      continue;
    }

    if (depth === 0) {
      if (char === ' ') {
        // A space only opens a boundary; an explicit combinator already seen
        // for this boundary is never downgraded by its surrounding spaces.
        if (current !== '' && boundary === null) boundary = 'descendant';
        continue;
      }
      if (char === '>' || char === '+' || char === '~') {
        if (current !== '' || boundary !== null) {
          boundary =
            char === '>' ? 'child' : char === '+' ? 'adjacent' : 'general';
        }
        continue;
      }
      closeBoundary();
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ']' || char === ')') {
      depth -= 1;
      current += char;
      continue;
    }
    current += char;
  }
  if (current !== '') {
    links.push({ compound: current, combinatorBefore: before });
  }

  return links;
};

interface CompoundAnalysis {
  model: SelectorModel;
  hasTypeSelector: boolean;
}

/** One compound selector → its flat parts. No combinators reach here. */
const analyzeCompound = (raw: string): CompoundAnalysis => {
  const classNames: string[] = [];
  const pseudo: string[] = [];
  const attributes: string[] = [];

  let depth = 0;
  let quote: string | null = null;
  let hasTypeSelector = false;
  let atCompoundStart = true;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '[') {
      if (depth === 0) {
        let end = index + 1;
        let inner: string | null = null;
        while (end < raw.length) {
          const next = raw[end];
          if (inner !== null) {
            if (next === '\\') end += 1;
            else if (next === inner) inner = null;
          } else if (next === '"' || next === "'") inner = next;
          else if (next === ']') break;
          end += 1;
        }
        const close = Math.min(end + 1, raw.length);
        attributes.push(raw.slice(index, close));
      }
      depth += 1;
      atCompoundStart = false;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']') {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;

    if (char === '.') {
      const name = readIdent(raw, index + 1);
      if (name !== '') classNames.push(name);
      index += name.length;
      atCompoundStart = false;
      continue;
    }
    if (char === ':') {
      const doubled = raw[index + 1] === ':';
      const from = index + (doubled ? 2 : 1);
      const name = readIdent(raw, from);
      if (name !== '') pseudo.push(`${doubled ? '::' : ':'}${name}`);
      index = from + name.length - 1;
      atCompoundStart = false;
      continue;
    }
    if (char === '*' || isIdentStart(char)) {
      if (atCompoundStart) hasTypeSelector = true;
      if (isIdentStart(char)) index += readIdent(raw, index).length - 1;
      atCompoundStart = false;
      continue;
    }

    atCompoundStart = false;
  }

  const model: SelectorModel = {
    raw,
    classNames,
    ...(pseudo.length === 0 ? {} : { pseudo }),
    ...(attributes.length === 0 ? {} : { attributes }),
  };

  return { model, hasTypeSelector };
};

/**
 * Selector text → the core `SelectorModel` plus its classification.
 *
 * The flat fields (`classNames`, `pseudo`, `attributes`) aggregate every
 * compound in source order — specificity is a property of the whole selector.
 * A relational selector additionally carries `subject` (the trailing
 * compound) and `ancestry` (the compounds before it, outermost first), so
 * candidacy and guard construction never have to re-derive the split.
 */
export const analyzeSelector = (raw: string): AnalyzedSelector => {
  const selector = raw.replace(/\s+/g, ' ').trim();
  const chain = splitCompoundChain(selector);
  const parts = chain.map((link) => analyzeCompound(link.compound));

  const classNames = parts.flatMap((part) => part.model.classNames);
  const pseudo = parts.flatMap((part) => part.model.pseudo ?? []);
  const attributes = parts.flatMap((part) => part.model.attributes ?? []);
  const hasTypeSelector = parts.some((part) => part.hasTypeSelector);
  const relational = chain.length > 1;

  const ancestry: AncestorLink[] = relational
    ? chain.slice(0, -1).map((link, index) => ({
        raw: link.compound,
        // Link i's combinator is its relation toward compound i+1 — the
        // chain records the relation *before* each compound instead.
        combinator: chain[index + 1].combinatorBefore ?? 'descendant',
        model: parts[index].model,
      }))
    : [];

  const model: SelectorModel = {
    raw: selector,
    classNames,
    ...(pseudo.length === 0 ? {} : { pseudo }),
    ...(attributes.length === 0 ? {} : { attributes }),
    ...(relational ? { subject: parts[parts.length - 1].model, ancestry } : {}),
  };

  const classification: SelectorClassification = relational
    ? 'relational'
    : hasTypeSelector || classNames.length === 0
      ? 'element'
      : 'class-simple';

  return { model, classification };
};

/**
 * A guard the universe derives from a relational selector's ancestor prefix
 * (PLACES.md §3): the root mode attribute maps onto the mode axis; every
 * other prefix becomes one `ancestor:<prefix>` axis. One axis per prefix —
 * NOT one per compound — because a descendant chain constrains ancestor
 * *order*, and a per-compound conjunction would establish rules the real
 * tree cannot match.
 */
export type AncestorGuard =
  | { kind: 'mode'; value: string }
  | { kind: 'axis'; dimension: string };

const COMBINATOR_GLYPH: Record<Exclude<Combinator, 'descendant'>, string> = {
  child: '>',
  adjacent: '+',
  general: '~',
};

/**
 * Quoted attribute values canonicalize to their unquoted form when they are
 * ident-safe, so `[data-active="true"]` and `[data-active=true]` name the
 * same axis regardless of how the emitting sheet quoted them. Place bindings
 * build axis names through this same helper — one canonical form, or the
 * establishment never matches the guard.
 */
export const canonicalCompound = (raw: string): string =>
  raw.replace(/=(["'])([A-Za-z0-9_-]+)\1\]/g, '=$2]');

/** The axis a prefix of ancestor links guards on, combinators preserved. */
export const ancestorAxisOf = (links: readonly AncestorLink[]): string => {
  let out = '';
  for (const link of links) {
    out += canonicalCompound(link.raw);
    out +=
      link.combinator === 'descendant'
        ? ' '
        : ` ${COMBINATOR_GLYPH[link.combinator]} `;
  }
  return `ancestor:${out.trim()}`;
};

export const ancestorGuardsOf = (
  analyzed: AnalyzedSelector
): AncestorGuard[] => {
  const ancestry = analyzed.model.ancestry;
  if (ancestry === undefined || ancestry.length === 0) return [];

  const links = [...ancestry];
  const guards: AncestorGuard[] = [];

  // The mode attribute is only the mode axis when it is the outermost
  // compound and a plain descendant — exactly the emitted dialect
  // (`[data-color-mode=m] .component`). Anything fancier stays a generic
  // ancestor axis rather than a guessed mode guard.
  const first = links[0];
  const mode =
    first.combinator === 'descendant' ? MODE_SELECTOR.exec(first.raw) : null;
  if (mode !== null) {
    guards.push({ kind: 'mode', value: mode[1] });
    links.shift();
  }

  if (links.length > 0) {
    guards.push({ kind: 'axis', dimension: ancestorAxisOf(links) });
  }
  return guards;
};
