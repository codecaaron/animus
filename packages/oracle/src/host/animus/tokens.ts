import { parseDeclarations } from './css-parse';
import { AnimusAdapterError } from './errors';
import { tokenReferencesIn } from './manifest-types';

import type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from '../../providers/tokens';
import type { ParsedDeclaration } from './css-parse';

/**
 * The reserved pseudo-mode for the raw `:root` value.
 *
 * `:root` is not a colour mode — it is the declaration layer every mode
 * overrides, and its values are frequently *aliases* (`--color-primary:
 * var(--color-blue-500)`) while the mode blocks are literals. Keeping it as a
 * distinct key preserves the alias (so `references` and `replace-token` deltas
 * see the real graph) instead of flattening it into whichever mode happened to
 * be default.
 */
export const ROOT_MODE = 'root';

const MODE_SELECTOR = /^\[data-color-mode=["']?([A-Za-z0-9_-]+)["']?\]$/;
const SCHEME_AT_RULE =
  /^@media\s*\(\s*prefers-color-scheme\s*:\s*([A-Za-z0-9_-]+)\s*\)$/;
const PURE_ALIAS = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
const BREAKPOINT = /^--breakpoint-([A-Za-z0-9_-]+)$/;
const PX = /^(-?\d+(?:\.\d+)?)px$/;
/** Where the pretty token prelude ends and the minified layers begin. */
const MINIFIED_LAYER = /^@layer\s+[\w-]+\{/m;

export interface Breakpoint {
  name: string;
  px: number;
}

export interface AnimusTokens extends TokenProvider {
  breakpoints(): readonly Breakpoint[];
  /** Honest notes about what the variable layer does and does not model. */
  notes(): readonly string[];
}

interface RawBlock {
  selector: string;
  body: string;
}

/**
 * Top-level `selector { … }` blocks of `text`, with nested bodies left raw.
 *
 * Brace-matching only — enough for the emitted variable prelude, which has no
 * braces inside strings, and deliberately not a second CSS parser.
 */
const eachBlock = (text: string): RawBlock[] => {
  const blocks: RawBlock[] = [];
  let pos = 0;

  while (pos < text.length) {
    const open = text.indexOf('{', pos);
    if (open === -1) break;

    const head = text.slice(pos, open);
    const statement = head.lastIndexOf(';');
    const selector = head
      .slice(statement + 1)
      .replace(/\s+/g, ' ')
      .trim();

    let depth = 1;
    let end = open + 1;
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') depth -= 1;
      end += 1;
    }

    blocks.push({ selector, body: text.slice(open + 1, end - 1) });
    pos = end;
  }

  return blocks;
};

const declarationsOf = (body: string, context: string): ParsedDeclaration[] =>
  parseDeclarations(body, (message, snippet) => {
    throw new AnimusAdapterError(message, {
      layer: 'tokens',
      construct: context,
      snippet,
    });
  });

interface Collected {
  /** variable → mode → raw value. */
  values: Map<string, Map<string, string>>;
  /** mode → its `color-scheme` declaration, when it has one. */
  colorScheme: Map<string, string>;
  modes: string[];
  schemeFallbacks: string[];
}

const record = (
  into: Collected,
  mode: string,
  declarations: readonly ParsedDeclaration[]
): void => {
  for (const declaration of declarations) {
    if (declaration.property === 'color-scheme') {
      if (!into.colorScheme.has(mode)) {
        into.colorScheme.set(mode, declaration.value);
      }
      continue;
    }
    if (!declaration.property.startsWith('--')) continue;

    const byMode =
      into.values.get(declaration.property) ?? new Map<string, string>();
    if (!byMode.has(mode)) byMode.set(mode, declaration.value);
    into.values.set(declaration.property, byMode);
  }
};

/**
 * Build a `TokenProvider` from the emitted stylesheet's variable blocks.
 *
 * Three block shapes carry variables and only two of them are modes:
 * `:root` (the declaration layer, `ROOT_MODE`), `[data-color-mode="m"]` (the
 * modes), and `@media (prefers-color-scheme: X) { :root:not([data-color-mode])
 * { … } }` — the system fallback. The fallback is *not* a mode: it applies
 * exactly when no mode is pinned, so admitting it as one would let a probe
 * bind `mode` and the fallback simultaneously, which no document can be in.
 * Its existence is recorded as a note instead.
 */
export const createAnimusTokens = (stylesheet: string): AnimusTokens => {
  const boundary = MINIFIED_LAYER.exec(stylesheet);
  const prelude =
    boundary === null ? stylesheet : stylesheet.slice(0, boundary.index);

  const collected: Collected = {
    values: new Map(),
    colorScheme: new Map(),
    modes: [],
    schemeFallbacks: [],
  };

  for (const block of eachBlock(prelude)) {
    if (block.selector === ':root') {
      record(collected, ROOT_MODE, declarationsOf(block.body, ':root'));
      continue;
    }

    const mode = MODE_SELECTOR.exec(block.selector);
    if (mode !== null) {
      if (!collected.modes.includes(mode[1])) collected.modes.push(mode[1]);
      record(collected, mode[1], declarationsOf(block.body, block.selector));
      continue;
    }

    const scheme = SCHEME_AT_RULE.exec(block.selector);
    if (scheme !== null) {
      if (!collected.schemeFallbacks.includes(scheme[1])) {
        collected.schemeFallbacks.push(scheme[1]);
      }
    }
  }

  const definitions = new Map<string, TokenDefinition>();
  for (const [variable, byMode] of collected.values) {
    const valuesByMode: Record<string, string> = {};
    const references: string[] = [];
    for (const [mode, value] of byMode) {
      valuesByMode[mode] = value;
      for (const reference of tokenReferencesIn(value)) {
        if (!references.includes(reference)) references.push(reference);
      }
    }
    definitions.set(variable, { variable, valuesByMode, references });
  }

  const rootScheme = collected.colorScheme.get(ROOT_MODE);
  const matchesRoot = (mode: string): boolean =>
    rootScheme !== undefined && collected.colorScheme.get(mode) === rootScheme;
  const defaultMode =
    collected.modes.find(matchesRoot) ?? collected.modes[0] ?? ROOT_MODE;

  const breakpoints: Breakpoint[] = [];
  for (const [variable, definition] of definitions) {
    const match = BREAKPOINT.exec(variable);
    if (match === null) continue;
    const raw = definition.valuesByMode[ROOT_MODE];
    const px = raw === undefined ? null : PX.exec(raw);
    if (px === null) continue;
    breakpoints.push({ name: match[1], px: Number(px[1]) });
  }
  breakpoints.sort((a, b) => a.px - b.px);

  const notes: string[] = [];
  if (collected.schemeFallbacks.length > 0) {
    notes.push(
      'the stylesheet declares `@media (prefers-color-scheme: ' +
        `${collected.schemeFallbacks.join('/')}) ` +
        ':root:not([data-color-mode])` fallback block(s) — they apply only ' +
        'when no mode is pinned and are not modeled as scenario modes'
    );
  }
  if (collected.modes.length === 0) {
    notes.push(
      'no `[data-color-mode="…"]` blocks were found — the `mode` dimension ' +
        'is absent and every token resolves through `:root` alone'
    );
  }

  const resolve = (
    variable: string,
    mode: string
  ): TokenResolution | undefined => {
    const chain: string[] = [variable];
    const seen = new Set<string>();
    let current = variable;

    for (;;) {
      if (seen.has(current)) return undefined;
      seen.add(current);

      const definition = definitions.get(current);
      if (definition === undefined) return undefined;

      const value =
        definition.valuesByMode[mode] ?? definition.valuesByMode[ROOT_MODE];
      if (value === undefined) return undefined;

      const alias = PURE_ALIAS.exec(value);
      if (alias === null) return { value, chain };

      chain.push(alias[1]);
      current = alias[1];
    }
  };

  return {
    modes: () => collected.modes,
    defaultMode: () => defaultMode,
    token: (variable: string) => definitions.get(variable),
    all: () => Array.from(definitions.values()),
    resolve,
    breakpoints: () => breakpoints,
    notes: () => notes,
  };
};
