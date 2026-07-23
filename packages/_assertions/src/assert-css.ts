export class AssertionError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AssertionError';
    this.details = details;
  }
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
  if (typeof marker === 'string') {
    return css.indexOf(marker);
  }
  const m = css.match(marker);
  return m?.index ?? -1;
}

function markerLabel(marker: LayerMarker): string {
  return typeof marker === 'string' ? marker : `/${marker.source}/`;
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

export function assertNoPlaceholders(css: string): void {
  const idx = css.indexOf('__TRANSFORM__');
  if (idx !== -1) {
    const start = Math.max(0, idx - 60);
    const end = Math.min(css.length, idx + 60);
    throw new AssertionError(
      `assertNoPlaceholders: found __TRANSFORM__ at offset ${idx}`,
      { context: css.slice(start, end) }
    );
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

/** The three structured parts returned by `assembleStylesheet({ split: true })`. */
export interface SplitStylesheetParts {
  declaration: string;
  variables: string;
  body: string;
}

/**
 * Assert the property-registration split contract (stylesheet-assembly delta,
 * "Property registration rules contained in the variables part"):
 *
 * - `@property` rules live in the `variables` part (at least one present),
 * - the `body` part contains none,
 * - the `declaration` part is only the `@layer` ordering statement (no
 *   `@property`), and
 * - rejoining the parts reproduces the non-split output — the same
 *   `[declaration, variables, body].filter(Boolean).join('\n')` that
 *   `assembleStylesheet` returns without `split`.
 *
 * Pure over the split parts + the non-split string; no I/O.
 */
export function assertPropertyRegistrationSplit(
  parts: SplitStylesheetParts,
  nonSplit: string
): void {
  const countProperties = (css: string): number =>
    (css.match(/@property\b/g) ?? []).length;

  const inVariables = countProperties(parts.variables);
  const inBody = countProperties(parts.body);
  const inDeclaration = countProperties(parts.declaration);

  if (inVariables < 1) {
    throw new AssertionError(
      'assertPropertyRegistrationSplit: expected @property rule(s) in the variables part, found none',
      { inVariables, inBody, inDeclaration }
    );
  }
  if (inBody !== 0) {
    throw new AssertionError(
      `assertPropertyRegistrationSplit: body part must contain no @property rules, found ${inBody}`,
      { inBody }
    );
  }
  if (inDeclaration !== 0) {
    throw new AssertionError(
      `assertPropertyRegistrationSplit: declaration part must contain no @property rules, found ${inDeclaration}`,
      { inDeclaration }
    );
  }
  if (!LAYER_DECLARATION_RE.test(parts.declaration)) {
    throw new AssertionError(
      'assertPropertyRegistrationSplit: declaration part must contain the @layer ordering statement',
      { declaration: parts.declaration }
    );
  }
  // "Only the @layer ordering statement": nothing may remain once the
  // ordering statement is removed (spec: declaration part SHALL remain
  // only the @layer ordering statement).
  if (parts.declaration.replace(LAYER_DECLARATION_RE, '').trim() !== '') {
    throw new AssertionError(
      'assertPropertyRegistrationSplit: declaration part must contain ONLY the @layer ordering statement',
      { declaration: parts.declaration }
    );
  }

  const rejoined = [parts.declaration, parts.variables, parts.body]
    .filter(Boolean)
    .join('\n');
  if (rejoined !== nonSplit) {
    throw new AssertionError(
      'assertPropertyRegistrationSplit: rejoined split parts do not equal the non-split output',
      { rejoined, nonSplit }
    );
  }
}

/** All `@layer <name> { … }` block spans (single-name block opens, brace-
 *  matched). The layer DECLARATION statement (`@layer a, b, c;`) is not a block
 *  and is excluded. Nested sublayers (`@layer composed { … }`) are included. */
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
  /**
   * At-rule families that must not appear outside a named `@layer` block.
   * Default covers the modern-css-surface conditions: `@container`,
   * `@supports`, and `@media` (breakpoint AND non-breakpoint — all conditioned
   * rules emit inside a layer, so the check is uniform).
   */
  atRules?: readonly string[];
}

/**
 * Assert Guardrail G2 (modern-css-surface): new condition at-rules SHALL NOT
 * appear outside a named `@layer` block in any emitted sheet. Every
 * `@container` / `@supports` / `@media` at-rule occurrence must fall inside a
 * `@layer <name> { … }` span. Position-aware (character-index containment), so
 * a correctly-named-but-misplaced at-rule fails fast — the whole reason this
 * package exists over `grep`.
 *
 * Vacuously green on output with no condition at-rules (arming, not asserting
 * presence). Pure over the CSS string; no I/O.
 */
export function assertConditionsInsideLayers(
  css: string,
  config?: ConditionsInsideLayersConfig
): void {
  const atRules = config?.atRules ?? ['@container', '@supports', '@media'];
  const spans = allLayerBlockSpans(css);
  const isInsideALayer = (index: number): boolean =>
    spans.some(([start, end]) => index >= start && index <= end);

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
