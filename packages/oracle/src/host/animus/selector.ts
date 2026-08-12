import { splitTopLevel } from './css-parse';

import type { SelectorModel } from '../../providers/style-universe';

/**
 * How much of a selector the closed model can decide from a scenario point
 * alone.
 *
 * - `class-simple` — one compound selector of classes (plus pseudo/attribute
 *   qualifiers). `TargetResolution.classes(point)` decides it outright.
 * - `element` — an element or universal selector (`body`, `*`, `:root`). It
 *   matches by tree position, not by the classes a target carries.
 * - `relational` — any combinator (descendant, `>`, `+`, `~`). Whether it
 *   applies depends on the host tree, which is Phase 2 (DESIGN §9.3); every
 *   such rule becomes a `tree-shape` obligation rather than a silent match.
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

/**
 * Selector text → the core `SelectorModel` plus its classification.
 *
 * Scanning is depth-aware so that a space inside `[data-x="a b"]` or `:is(a b)`
 * is not mistaken for a descendant combinator — the difference decides whether
 * a rule is decidable from a scenario point or becomes an obligation.
 */
export const analyzeSelector = (raw: string): AnalyzedSelector => {
  const selector = raw.replace(/\s+/g, ' ').trim();
  const classNames: string[] = [];
  const pseudo: string[] = [];
  const attributes: string[] = [];

  let depth = 0;
  let quote: string | null = null;
  let relational = false;
  let sawCompoundContent = false;
  let hasTypeSelector = false;
  let atCompoundStart = true;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

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
        while (end < selector.length) {
          const next = selector[end];
          if (inner !== null) {
            if (next === '\\') end += 1;
            else if (next === inner) inner = null;
          } else if (next === '"' || next === "'") inner = next;
          else if (next === ']') break;
          end += 1;
        }
        const close = Math.min(end + 1, selector.length);
        attributes.push(selector.slice(index, close));
      }
      depth += 1;
      sawCompoundContent = true;
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

    if (char === ' ') {
      if (sawCompoundContent) relational = true;
      atCompoundStart = true;
      continue;
    }
    if (char === '>' || char === '+' || char === '~') {
      relational = true;
      atCompoundStart = true;
      continue;
    }

    if (char === '.') {
      const name = readIdent(selector, index + 1);
      if (name !== '') classNames.push(name);
      index += name.length;
      sawCompoundContent = true;
      atCompoundStart = false;
      continue;
    }
    if (char === ':') {
      const doubled = selector[index + 1] === ':';
      const from = index + (doubled ? 2 : 1);
      const name = readIdent(selector, from);
      if (name !== '') pseudo.push(`${doubled ? '::' : ':'}${name}`);
      index = from + name.length - 1;
      sawCompoundContent = true;
      atCompoundStart = false;
      continue;
    }
    if (char === '*' || isIdentStart(char)) {
      if (atCompoundStart) hasTypeSelector = true;
      if (isIdentStart(char)) index += readIdent(selector, index).length - 1;
      sawCompoundContent = true;
      atCompoundStart = false;
      continue;
    }

    sawCompoundContent = true;
    atCompoundStart = false;
  }

  const model: SelectorModel = {
    raw: selector,
    classNames,
    ...(pseudo.length === 0 ? {} : { pseudo }),
    ...(attributes.length === 0 ? {} : { attributes }),
  };

  const classification: SelectorClassification = relational
    ? 'relational'
    : hasTypeSelector || classNames.length === 0
      ? 'element'
      : 'class-simple';

  return { model, classification };
};
