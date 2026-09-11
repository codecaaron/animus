import { splitTopLevel } from './css-parse';
import { MODE_SELECTOR } from './tokens';

import type {
  AncestorLink,
  SelectorModel,
} from '../../providers/style-universe';

/**
 * How much of a selector a point alone decides: `class-simple` outright,
 * `element` by tree position, `relational` only once its ancestor axis binds.
 */
export type SelectorClassification = 'class-simple' | 'element' | 'relational';

export interface AnalyzedSelector {
  model: SelectorModel;
  classification: SelectorClassification;
}

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
  combinatorBefore: Combinator | null;
}

const splitCompoundChain = (selector: string): CompoundChainLink[] => {
  const links: CompoundChainLink[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  let before: Combinator | null = null;
  let boundary: Combinator | null = null;

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

  const model: SelectorModel = { raw, classNames };
  if (pseudo.length > 0) model.pseudo = pseudo;
  if (attributes.length > 0) model.attributes = attributes;

  return { model, hasTypeSelector };
};

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
        combinator: chain[index + 1].combinatorBefore ?? 'descendant',
        model: parts[index].model,
      }))
    : [];

  const model: SelectorModel = { raw: selector, classNames };
  if (pseudo.length > 0) model.pseudo = pseudo;
  if (attributes.length > 0) model.attributes = attributes;
  if (relational) {
    model.subject = parts[parts.length - 1].model;
    model.ancestry = ancestry;
  }

  const classification: SelectorClassification = relational
    ? 'relational'
    : hasTypeSelector || classNames.length === 0
      ? 'element'
      : 'class-simple';

  return { model, classification };
};

export type AncestorGuard =
  | { kind: 'mode'; value: string }
  | { kind: 'axis'; dimension: string };

const COMBINATOR_GLYPH = {
  child: '>',
  adjacent: '+',
  general: '~',
} satisfies Record<Exclude<Combinator, 'descendant'>, string>;

export const canonicalCompound = (raw: string): string =>
  raw.replace(/=(["'])([A-Za-z0-9_-]+)\1\]/g, '=$2]');

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
