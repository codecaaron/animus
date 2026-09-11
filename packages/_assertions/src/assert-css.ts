import type { JsonObject } from './json';

export class AssertionError extends Error {
  details?: JsonObject;

  constructor(message: string, details?: JsonObject) {
    super(message);
    this.name = 'AssertionError';
    this.details = details;
  }
}

/**
 * Collapse all whitespace so minified and pretty-printed forms compare equal.
 */
export function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

export type LayerMarker = string | RegExp;

export interface LayerOrderConfig {
  layers?: readonly LayerMarker[];
}

export function layerBlock(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@layer\\s+${escaped}\\s*\\{`);
}

export const LAYER_DECLARATION_RE = /@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/;

const DEFAULT_LAYER_ORDER: readonly LayerMarker[] = [
  LAYER_DECLARATION_RE,
  ':root',
  layerBlock('anm-global'),
  layerBlock('anm-base'),
  layerBlock('anm-variants'),
];

function findMarkerIndex(css: string, marker: LayerMarker): number {
  if (marker instanceof RegExp) {
    const m = css.match(marker);
    return m?.index ?? -1;
  }
  return css.indexOf(marker);
}

function markerLabel(marker: LayerMarker): string {
  return marker instanceof RegExp ? `/${marker.source}/` : marker;
}

export function assertLayerOrder(css: string, config?: LayerOrderConfig): void {
  const layers = config?.layers ?? DEFAULT_LAYER_ORDER;
  const positions = layers.map((marker) => ({
    name: markerLabel(marker),
    index: findMarkerIndex(css, marker),
  }));

  const missing = positions.filter((p) => p.index === -1);
  if (missing.length > 0) {
    throw new AssertionError(
      `assertLayerOrder: missing expected layer markers: ${missing.map((m) => m.name).join(', ')}`,
      { missing: missing.map((m) => m.name) }
    );
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    if (a.index >= b.index) {
      throw new AssertionError(
        `assertLayerOrder: '${a.name}' (offset ${a.index}) must precede '${b.name}' (offset ${b.index})`,
        { violation: { before: a, after: b } }
      );
    }
  }
}

// `__TRANSFORM__` is an unresolved transform slot, `animus-asset:` an asset
// reference the host plugin failed to substitute. Neither may reach delivery.
const PLACEHOLDER_MARKERS = ['__TRANSFORM__', 'animus-asset:'] as const;

export function assertNoPlaceholders(css: string): void {
  for (const marker of PLACEHOLDER_MARKERS) {
    const idx = css.indexOf(marker);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(css.length, idx + 60);
      throw new AssertionError(
        `assertNoPlaceholders: found ${marker} at offset ${idx}`,
        { context: css.slice(start, end) }
      );
    }
  }
}

export interface ClassNameFormatConfig {
  prefix?: string;
}

export function assertClassNameFormat(
  content: string,
  config?: ClassNameFormatConfig
): void {
  const prefix = config?.prefix ?? 'animus-';
  if (!content.includes(prefix)) {
    throw new AssertionError(
      `assertClassNameFormat: no class names found with prefix '${prefix}'`,
      { prefix }
    );
  }
}

export interface UnresolvedTokensConfig {
  forbiddenPatterns?: readonly RegExp[];
}

const DEFAULT_TOKEN_PATTERNS: readonly RegExp[] = [
  /\{colors\.[a-zA-Z][\w.-]*\}/,
  /\{space\.[a-zA-Z][\w.-]*\}/,
  /\{fontSizes?\.[a-zA-Z][\w.-]*\}/,
];

export function assertNoUnresolvedTokens(
  css: string,
  config?: UnresolvedTokensConfig
): void {
  const patterns = config?.forbiddenPatterns ?? DEFAULT_TOKEN_PATTERNS;
  const matches: Array<{ pattern: string; match: string }> = [];
  for (const pattern of patterns) {
    const m = css.match(pattern);
    if (m) {
      matches.push({ pattern: pattern.source, match: m[0] });
    }
  }
  if (matches.length > 0) {
    throw new AssertionError(
      `assertNoUnresolvedTokens: found unresolved token references: ${matches.map((m) => m.match).join(', ')}`,
      { matches }
    );
  }
}

function allLayerBlockSpans(css: string): [number, number][] {
  const openRe = /@layer\s+[\w-]+\s*\{/g;
  const spans: [number, number][] = [];
  for (const m of css.matchAll(openRe)) {
    if (m.index === undefined) continue;
    const afterOpen = m.index + m[0].length;
    let depth = 1;
    let cursor = afterOpen;
    while (cursor < css.length && depth > 0) {
      const ch = css[cursor];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      if (depth > 0) cursor += 1;
    }
    spans.push([m.index, cursor]);
  }
  return spans;
}

export interface ConditionsInsideLayersConfig {
  atRules?: readonly string[];
  /**
   * `[start, end]` spans exempt from the layer requirement; a span suppresses
   * the check over its whole character range. See `systemSchemeVariableSpans`.
   */
  exemptSpans?: readonly (readonly [number, number])[];
}

/**
 * Every condition at-rule occurrence must fall inside a `@layer <name>` span.
 * Vacuously green on a sheet with no condition at-rules.
 */
export function assertConditionsInsideLayers(
  css: string,
  config?: ConditionsInsideLayersConfig
): void {
  const atRules = config?.atRules ?? ['@container', '@supports', '@media'];
  const spans = allLayerBlockSpans(css);
  const exempt = config?.exemptSpans ?? [];
  const isInsideALayer = (index: number): boolean =>
    spans.some(([start, end]) => index >= start && index <= end) ||
    exempt.some(([start, end]) => index >= start && index <= end);

  const offenders: Array<{ atRule: string; index: number; context: string }> =
    [];
  for (const atRule of atRules) {
    const re = new RegExp(`${escapeForRegExp(atRule)}\\b`, 'g');
    for (const m of css.matchAll(re)) {
      if (m.index === undefined) continue;
      if (!isInsideALayer(m.index)) {
        offenders.push({
          atRule,
          index: m.index,
          context: css.slice(Math.max(0, m.index - 40), m.index + 60),
        });
      }
    }
  }

  if (offenders.length > 0) {
    throw new AssertionError(
      `assertConditionsInsideLayers: found ${offenders.length} condition at-rule(s) outside any @layer block: ${offenders
        .map((o) => `${o.atRule}@${o.index}`)
        .join(', ')}`,
      { offenders }
    );
  }
}

export function assertNoEmotionImports(jsContent: string): void {
  const idx = jsContent.indexOf('@emotion');
  if (idx !== -1) {
    const start = Math.max(0, idx - 40);
    const end = Math.min(jsContent.length, idx + 80);
    throw new AssertionError(
      `assertNoEmotionImports: found '@emotion' reference at offset ${idx}`,
      { context: jsContent.slice(start, end) }
    );
  }
}

/**
 * A production bundle carries no dev-only diagnostic string: the
 * `__ANIMUS_DEV__` define folds false so the minifier drops the gated code.
 */
export function assertNoDevDiagnostics(
  jsContent: string,
  marker = 'animus:drop'
): void {
  const offset = jsContent.indexOf(marker);
  if (offset !== -1) {
    throw new AssertionError(
      `assertNoDevDiagnostics: bundle still contains the dev-diagnostic marker '${marker}' at offset ${offset} — the __ANIMUS_DEV__ define did not fold`,
      { marker, offset }
    );
  }
}

export interface KeyframesAssertionConfig {
  minBlocks?: number;
  minReferences?: number;
  namePrefix?: string;
  insideLayer?: string;
}

const KEYFRAME_NAME_KEYWORDS = new Set([
  'none',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
]);

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function layerSpans(css: string, name: string): [number, number][] {
  const openRe = new RegExp(`@layer\\s+${escapeForRegExp(name)}\\s*\\{`, 'g');
  const spans: [number, number][] = [];
  for (const m of css.matchAll(openRe)) {
    if (m.index === undefined) continue;
    const afterOpen = m.index + m[0].length;
    let depth = 1;
    let cursor = afterOpen;
    while (cursor < css.length && depth > 0) {
      const ch = css[cursor];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) cursor++;
    }
    spans.push([afterOpen, cursor]);
  }
  return spans;
}

/**
 * Body of the FIRST `@layer <name>` block, brace-matched, or `undefined` when
 * the sheet declares no such block.
 */
export function layerBlockBody(css: string, name: string): string | undefined {
  const [span] = layerSpans(css, name);
  return span ? css.slice(span[0], span[1]) : undefined;
}

export function assertKeyframesExtracted(
  css: string,
  config?: KeyframesAssertionConfig
): void {
  const minBlocks = config?.minBlocks ?? 1;
  const minReferences = config?.minReferences ?? 1;
  const namePrefix = config?.namePrefix ?? 'animus-kf-';
  const insideLayer = config?.insideLayer;
  const prefixRe = escapeForRegExp(namePrefix);

  const blockRe = new RegExp(`@keyframes\\s+(${prefixRe}[\\w-]+)\\s*\\{`, 'g');
  const emittedNames = new Set<string>();
  const blockOffsets: { name: string; index: number }[] = [];
  for (const m of css.matchAll(blockRe)) {
    if (m.index === undefined) continue;
    emittedNames.add(m[1]);
    blockOffsets.push({ name: m[1], index: m.index });
  }

  if (emittedNames.size < minBlocks) {
    throw new AssertionError(
      `assertKeyframesExtracted: expected at least ${minBlocks} @keyframes block(s) with prefix '${namePrefix}', found ${emittedNames.size}`,
      { emittedNames: [...emittedNames], minBlocks }
    );
  }

  const refRe = /animation-name\s*:\s*([^;}\s]+)/g;
  const referencedValues = new Set<string>();
  for (const m of css.matchAll(refRe)) {
    const raw = m[1].trim().replace(/,$/, '');
    if (KEYFRAME_NAME_KEYWORDS.has(raw.toLowerCase())) continue;
    referencedValues.add(raw);
  }

  const prefixedRefs = [...referencedValues].filter((v) =>
    v.startsWith(namePrefix)
  );
  if (prefixedRefs.length < minReferences) {
    throw new AssertionError(
      `assertKeyframesExtracted: expected at least ${minReferences} animation-name reference(s) with prefix '${namePrefix}', found ${prefixedRefs.length}`,
      { prefixedRefs, minReferences }
    );
  }

  const mangleRe = new RegExp(`animation-name\\s*:\\s*${prefixRe}[\\w-]+px\\b`);
  const mangleMatch = css.match(mangleRe);
  if (mangleMatch) {
    throw new AssertionError(
      `assertKeyframesExtracted: animation-name value has trailing 'px' — UNITLESS_PROPERTIES regression mangled an identifier: '${mangleMatch[0]}'`,
      { match: mangleMatch[0] }
    );
  }

  const dangling = prefixedRefs.filter((v) => !emittedNames.has(v));
  if (dangling.length > 0) {
    throw new AssertionError(
      `assertKeyframesExtracted: animation-name reference(s) have no matching @keyframes block: ${dangling.join(', ')}`,
      { dangling, emittedNames: [...emittedNames] }
    );
  }

  if (insideLayer) {
    const spans = layerSpans(css, insideLayer);
    if (spans.length === 0) {
      throw new AssertionError(
        `assertKeyframesExtracted: expected keyframes inside @layer ${insideLayer}, but no @layer ${insideLayer} block was found`,
        { insideLayer }
      );
    }
    const outside = blockOffsets.filter(
      (b) => !spans.some(([start, end]) => b.index >= start && b.index <= end)
    );
    if (outside.length > 0) {
      throw new AssertionError(
        `assertKeyframesExtracted: @keyframes block(s) outside @layer ${insideLayer}: ${outside.map((b) => b.name).join(', ')}`,
        { outside, insideLayer, spans }
      );
    }
  }
}

export interface KeyframesUniqueBodiesConfig {
  namePrefix?: string;
}

/**
 * One `@keyframes` block per unique frame body: the name derives from the body,
 * so two names for one body means the emission path ran twice.
 */
export function assertKeyframesUniqueBodies(
  css: string,
  config?: KeyframesUniqueBodiesConfig
): void {
  const namePrefix = config?.namePrefix ?? 'animus-kf-';
  const openRe = new RegExp(
    `@keyframes\\s+(${escapeForRegExp(namePrefix)}[\\w-]+)\\s*\\{`,
    'g'
  );

  const byBody = new Map<string, string[]>();
  for (const m of css.matchAll(openRe)) {
    if (m.index === undefined) continue;
    const afterOpen = m.index + m[0].length;
    let depth = 1;
    let cursor = afterOpen;
    while (cursor < css.length && depth > 0) {
      const ch = css[cursor];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) cursor++;
    }
    const body = css.slice(afterOpen, cursor).replace(/\s+/g, '');
    const names = byBody.get(body) ?? [];
    names.push(m[1]);
    byBody.set(body, names);
  }

  const duplicated = [...byBody.entries()].filter(
    ([, names]) => names.length > 1
  );
  if (duplicated.length > 0) {
    throw new AssertionError(
      `assertKeyframesUniqueBodies: frame body emitted more than once: ${duplicated
        .map(([, names]) => names.join(' / '))
        .join('; ')}`,
      {
        duplicated: duplicated.map(([body, names]) => ({ names, body })),
      }
    );
  }
}

export interface SelectorEmissionConfig {
  pattern: RegExp;
  label: string;
  minMatches?: number;
}

/**
 * At least `minMatches` innermost rule preludes match `pattern`, pinning the
 * class to a selector position. Patterns must tolerate minified preludes.
 */
export function assertSelectorEmitted(
  css: string,
  config: SelectorEmissionConfig
): void {
  const minMatches = config.minMatches ?? 1;
  const matches: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = m[1].trim();
    if (config.pattern.test(prelude)) matches.push(prelude);
  }
  if (matches.length < minMatches) {
    throw new AssertionError(
      `assertSelectorEmitted: expected at least ${minMatches} rule prelude(s) matching ${config.label} (/${config.pattern.source}/), found ${matches.length}`,
      { label: config.label, pattern: config.pattern.source, matches }
    );
  }
}

/**
 * No literal `&` survives into an emitted sheet: every authored ampersand must
 * have been substituted with the composed class.
 */
export function assertNoLiteralAmpersand(css: string): void {
  const idx = css.indexOf('&');
  if (idx !== -1) {
    const start = Math.max(0, idx - 60);
    const end = Math.min(css.length, idx + 60);
    throw new AssertionError(
      `assertNoLiteralAmpersand: found literal '&' at offset ${idx}`,
      { offset: idx, context: css.slice(start, end) }
    );
  }
}

export interface VariantDeclarationParityConfig {
  components: readonly [string, string];
  optionSuffixes: readonly string[];
  includeBase?: boolean;
  prefix?: string;
}

function componentClassBase(
  css: string,
  prefix: string,
  component: string
): string {
  const hashRe = new RegExp(
    `${escapeForRegExp(prefix + component)}-([0-9a-f]+)`,
    'g'
  );
  const hashes = new Set<string>();
  for (const m of css.matchAll(hashRe)) hashes.add(m[1]);
  if (hashes.size !== 1) {
    throw new AssertionError(
      `assertVariantDeclarationParity: expected exactly one class hash for component '${component}', found ${hashes.size}`,
      { component, hashes: [...hashes] }
    );
  }
  return `${prefix}${component}-${[...hashes][0]}`;
}

function tokenDeclarations(css: string, token: string): string[] {
  // The lookahead keeps a base token from matching its own variant tokens
  // (`token--size-sm`), and a suffix from matching a longer suffix it prefixes.
  const tokenRe = new RegExp(`${escapeForRegExp(token)}(?![\\w-])`);
  const declarations: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!tokenRe.test(m[1])) continue;
    for (const declaration of m[2].split(';')) {
      const trimmed = declaration.trim();
      if (trimmed) declarations.push(trimmed);
    }
  }
  // Declaration order is part of the comparison: it changes CSS semantics for
  // duplicate and shorthand/longhand pairs, so sorting would hide divergence.
  return declarations;
}

/**
 * Declaration equality between a binding-backed component and its
 * inline-authored sibling, paired by variant-option suffix; hashes differ.
 */
export function assertVariantDeclarationParity(
  css: string,
  config: VariantDeclarationParityConfig
): void {
  const prefix = config.prefix ?? 'animus-';
  const includeBase = config.includeBase ?? true;
  const [left, right] = config.components;
  const leftBase = componentClassBase(css, prefix, left);
  const rightBase = componentClassBase(css, prefix, right);

  const suffixes = [
    ...(includeBase ? [''] : []),
    ...config.optionSuffixes.map((s) => `--${s}`),
  ];
  for (const suffix of suffixes) {
    const leftDecls = tokenDeclarations(css, `${leftBase}${suffix}`);
    const rightDecls = tokenDeclarations(css, `${rightBase}${suffix}`);
    const label = suffix === '' ? '<base>' : suffix;
    if (leftDecls.length === 0 || rightDecls.length === 0) {
      throw new AssertionError(
        `assertVariantDeclarationParity: no declarations found for ${label} on ${leftDecls.length === 0 ? left : right} — expected both siblings to emit this class`,
        { suffix: label, leftDecls, rightDecls }
      );
    }
    if (leftDecls.join(';') !== rightDecls.join(';')) {
      throw new AssertionError(
        `assertVariantDeclarationParity: declaration mismatch for ${label} between ${left} and ${right}`,
        {
          suffix: label,
          [left]: leftDecls.join(';'),
          [right]: rightDecls.join(';'),
        }
      );
    }
  }
}
