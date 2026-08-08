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

// Pipeline-internal markers that must never survive into delivered CSS:
// unresolved transform slots, and asset() placeholders the host plugin
// failed to substitute (standardize-inheritance-and-assets).
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
  /**
   * `[start, end]` character spans that are exempt from the layer requirement.
   *
   * The one legitimate producer of unlayered condition at-rules is the theme's
   * VARIABLE part: the system-color-scheme fallback blocks live beside `:root`
   * and the `[data-color-mode]` blocks, outside any layer, because variable
   * resolution must not enter the layer order.
   *
   * Callers pass `systemSchemeVariableSpans(css)`, which grants a
   * `prefers-color-scheme` block its span only when it sits **unlayered ahead
   * of the first `@layer` block**, **every rule inside it targets
   * `:root:not([data-color-mode])`**, and **the block contains no nested
   * at-rule**. An unguarded rule, a nested at-rule, or a position past the
   * first layer block forfeits the exemption and the block trips this gate.
   *
   * The nested-at-rule condition is load-bearing, not belt-and-braces: a span
   * suppresses this check across its whole character range, so an at-rule
   * nested inside an otherwise-exempt block would ride along unexamined. Cover
   * is therefore withheld from the whole block rather than granted blindly.
   */
  exemptSpans?: readonly (readonly [number, number])[];
}

/**
 * Assert arch-css-structural-gates › "Condition at-rules gated inside layer
 * blocks": new condition at-rules SHALL NOT appear outside a named `@layer`
 * block in any emitted sheet. Every
 * `@container` / `@supports` / `@media` at-rule occurrence must fall inside a
 * `@layer <name> { … }` span. Position-aware (character-index containment), so
 * a correctly-named-but-misplaced at-rule fails fast — the whole reason this
 * package exists over `grep`.
 *
 * Vacuously green on output with no condition at-rules (arming, not asserting
 * presence). Pure over the CSS string; no I/O.
 *
 * See `exemptSpans` for the one sanctioned unlayered producer — the theme's
 * variable-level system fallback blocks.
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
 * The production-fold witness: no development-only diagnostic string survives
 * in a production bundle. The runtime's dev paths are gated on the
 * `__ANIMUS_DEV__` define the Animus plugins supply, which a production build
 * sets to false so the minifier drops the gated code and its strings — the
 * drop warning's prefix is the stable marker. Its reappearance means the fold
 * stopped working and every gated diagnostic is shipping to users. See
 * packages/system/src/runtime/is-dev.ts for which hosts fold and which do not.
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
 * Assert exactly one `@keyframes` block per unique frame body
 * (rust-extraction-pipeline external-collection scenario): the FNV name
 * derives from the frame body, so a body emitted under two names, or the same
 * block emitted twice, means the single
 * `keyframes_blocks` emission path duplicated work (e.g. an external-package
 * collection emitted once by the kit scan and again by the consumer).
 *
 * Whitespace-normalized body comparison; vacuously green on output with no
 * prefixed `@keyframes` blocks (presence is assertKeyframesExtracted's job).
 * Pure over the CSS string; no I/O.
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
  /** Tested against each innermost rule prelude in the sheet. */
  pattern: RegExp;
  /** Names the witness in the failure message. */
  label: string;
  /** Minimum number of matching rule preludes (default 1). */
  minMatches?: number;
}

/**
 * Assert that at least `minMatches` innermost rule preludes match `pattern`
 * (nested-selector-resolution): the ancestor/repeated/alias subject witnesses
 * check the COMPOSED selector text — e.g.
 * `[data-active="true"] .animus-…` with the class at the subject position —
 * which plain substring probes cannot pin to a selector position. Preludes
 * are matched after minification, so patterns must tolerate optional
 * attribute-value quotes and collapsed whitespace. Pure over the CSS string;
 * no I/O.
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
 * Assert that no literal `&` survives into a produced stylesheet
 * (nested-selector-resolution). Every unquoted `&` in an authored selector
 * must have been substituted with the composed class; ANY remaining
 * ampersand — even
 * inside quoted attribute text, which no current fixture emits — fails loud
 * with its offset and context so the sheet stays byte-auditable with
 * `grep -c '&'` → 0. Pure over the CSS string; no I/O.
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
  /** Component display names as they appear in emitted class tokens. */
  components: readonly [string, string];
  /** Variant option suffixes that must exist on BOTH (e.g. 'size-sm'). */
  optionSuffixes: readonly string[];
  /** Also compare the bare base classes (default true). */
  includeBase?: boolean;
  /** Class name prefix (default 'animus-'). */
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
  // Word-ish boundary: the base token must not swallow its own variant
  // tokens (`token--size-sm`), and a suffix token must not match a longer
  // suffix it happens to prefix.
  const tokenRe = new RegExp(`${escapeForRegExp(token)}(?![\\w-])`);
  const declarations: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!tokenRe.test(m[1])) continue;
    for (const declaration of m[2].split(';')) {
      const compact = declaration.trim();
      if (compact) declarations.push(compact);
    }
  }
  // Emitted order is the comparison surface: order changes CSS semantics
  // for duplicate properties and shorthand/longhand pairs, so sorting here
  // would let order-divergent siblings pass as equal.
  return declarations;
}

/**
 * Assert per-class declaration equality between a binding-backed component
 * and its inline-authored sibling (semantic-const-resolution): a variant map
 * imported across a package boundary must produce the SAME declarations as
 * inlining the literal —
 * base class and every option class. Classes are paired by variant-option
 * suffix; hashes and display names differ by construction, declaration lists
 * may not. A divergence is STOP evidence: the error carries both full
 * declaration lists for the byte diff. Pure over the CSS string; no I/O.
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
