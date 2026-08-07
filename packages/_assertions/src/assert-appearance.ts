/**
 * Structural assertions for the system color-scheme surface
 * (openspec: system-color-scheme).
 *
 * These run over BUILT CSS — after Lightning CSS (Vite) or Next's own
 * minifier — so every matcher here tolerates the transformations a minifier is
 * allowed to make and pins only what the spec actually promises:
 *
 * - attribute selectors lose their quotes (`[data-color-mode="dark"]` ships as
 *   `[data-color-mode=dark]`), so mode matching is quote-insensitive;
 * - Lightning CSS injects `--lightningcss-light` / `--lightningcss-dark` pairs
 *   into every rule that declares `color-scheme`. It injects them into the
 *   guarded media block AND the attribute block alike, which is why
 *   declaration-list equality between the two still holds and is worth pinning.
 *
 * Everything is pure over the CSS string; no I/O.
 */
import { AssertionError } from './assert-css';

/** The two OS color-scheme preferences a theme can map a mode onto. */
export type OsScheme = 'light' | 'dark';

/** The guard the emitter writes so an explicit mode wins purely in CSS. */
const DEFAULT_GUARD = ':root:not([data-color-mode])';

/** Collapse whitespace so a minified and a pretty-printed form compare equal. */
function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

/** Whitespace-normalized, order-preserving declaration list of a rule body. */
function declarationList(body: string): string[] {
  return body
    .split(';')
    .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
    .filter((declaration) => declaration !== '');
}

/** Index of the `}` closing the `{` at `openIndex`, or -1 when unbalanced. */
function matchBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let cursor = openIndex; cursor < css.length; cursor += 1) {
    if (css[cursor] === '{') depth += 1;
    else if (css[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

interface Rule {
  /** Prelude as authored/minified — the selector, or an at-rule prelude. */
  prelude: string;
  /** Declarations between the braces, excluding any nested block. */
  body: string;
  /** Offset of the prelude in the ORIGINAL css string. */
  index: number;
}

/**
 * Every style rule inside `css`, at any nesting depth, with offsets relative to
 * the original string. At-rules are descended into rather than returned, so an
 * `@media` wrapper never masks the rules it guards.
 */
function styleRules(css: string, offset = 0): Rule[] {
  const rules: Rule[] = [];
  let cursor = 0;
  let preludeStart = 0;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '}' || char === ';') {
      cursor += 1;
      preludeStart = cursor;
      continue;
    }
    if (char !== '{') {
      cursor += 1;
      continue;
    }
    const close = matchBrace(css, cursor);
    if (close === -1) break;
    const raw = css.slice(preludeStart, cursor);
    const prelude = raw.trim();
    const body = css.slice(cursor + 1, close);
    if (prelude.startsWith('@')) {
      rules.push(...styleRules(body, offset + cursor + 1));
    } else {
      rules.push({
        prelude,
        body,
        index: offset + preludeStart + (raw.length - raw.trimStart().length),
      });
    }
    cursor = close + 1;
    preludeStart = cursor;
  }
  return rules;
}

interface SchemeBlock {
  scheme: OsScheme;
  /** Offset of the `@media` at-rule in `css`. */
  index: number;
  /** Style rules directly guarded by this media block. */
  rules: Rule[];
}

/** Every `@media (prefers-color-scheme: light|dark)` block and its rules. */
function schemeBlocks(css: string): SchemeBlock[] {
  const blocks: SchemeBlock[] = [];
  const openRe = /@media[^{]*prefers-color-scheme\s*:\s*(light|dark)[^{]*\{/g;
  for (const match of css.matchAll(openRe)) {
    if (match.index === undefined) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBrace(css, open);
    if (close === -1) continue;
    blocks.push({
      scheme: match[1] as OsScheme,
      index: match.index,
      rules: styleRules(css.slice(open + 1, close), open + 1),
    });
  }
  return blocks;
}

/**
 * True when any comma-part of `selector` targets the document root via
 * `:root` — the ONLY root spelling the theme emitter writes.
 *
 * Deliberately NOT matching bare `html`: an application may legitimately author
 * `html { _osDark: { … } }` in its global styles, which emits an unguarded
 * `@media (prefers-color-scheme: dark) { html { … } }` block that is the app's
 * own business — the guard contract governs the emitter's fallback blocks, and
 * those are always `:root`-based. Widening this to `html` turned that
 * legitimate authoring shape into a false positive.
 */
function targetsRoot(selector: string): boolean {
  return selector
    .split(',')
    .some((part) => /(^|[\s>+~]):root\b/.test(part.trim()));
}

/** Locate the `[data-color-mode=<mode>]` rule, quoted or minified-bare. */
function modeRule(css: string, mode: string): Rule | undefined {
  const re = new RegExp(
    `\\[data-color-mode\\s*=\\s*["']?${mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\]`
  );
  return styleRules(css).find((rule) => re.test(rule.prelude));
}

/**
 * Character spans of the theme's VARIABLE-LEVEL system fallback blocks —
 * `@media (prefers-color-scheme: …) { :root:not([data-color-mode]) { … } }`.
 *
 * These sit in the unlayered variables part of the sheet, alongside `:root` and
 * the `[data-color-mode]` blocks, because that is what the emission contract
 * requires: the fallback must follow `:root` and be overridable by an explicit
 * mode block at the same (unlayered) cascade level. Wrapping them in a
 * `@layer` would move variable resolution into the layer order and break both.
 *
 * That puts them in direct tension with the modern-css-surface gate
 * `assertConditionsInsideLayers`, which requires every condition at-rule to
 * nest inside a named layer — a rule written for COMPONENT condition at-rules,
 * before variable-level media blocks existed. Pass these spans as
 * `exemptSpans` to reconcile the two gates.
 *
 * The exemption is EARNED, not asserted. A `prefers-color-scheme` block joins
 * this list only when all three hold (arch-css-structural-gates: "unlayered
 * ahead of the first `@layer` block… no nested at-rule"):
 *
 * 1. **Position** — it begins before the first `@layer <name> { … }` block
 *    opening in the sheet, i.e. it really is in the variables part. The
 *    `@layer a, b, c;` ordering STATEMENT is not a block and does not count.
 *    Without this, an exempt-looking block could sit anywhere, including past
 *    the point where the containment gate is the only thing still watching.
 * 2. **Every rule is the root guard** — one non-guard selector forfeits the
 *    whole block. An application's own `_osDark` component block, the exact
 *    shape the layer gate exists to catch, is never exempt.
 * 3. **No nested at-rule** — the span suppresses the containment gate over its
 *    whole character range, so anything nested inside would ride along
 *    unchecked. A block containing `@supports`, `@container`, a nested
 *    `@media`, or any other at-rule forfeits rather than granting cover.
 *
 * Forfeiting is always the safe direction: a block that loses its exemption is
 * simply handed back to `assertConditionsInsideLayers`, which trips.
 */
export function systemSchemeVariableSpans(css: string): [number, number][] {
  // First LAYER BLOCK opening. `@layer a, b, c;` is a declaration statement,
  // not a block, and the trailing `,`/`;` keeps it from matching here.
  const firstLayerBlock = css.match(/@layer\s+[\w-]+\s*\{/)?.index ?? -1;

  const spans: [number, number][] = [];
  for (const block of schemeBlocks(css)) {
    if (block.rules.length === 0) continue;

    // (1) position: must precede the layered part of the sheet.
    if (firstLayerBlock !== -1 && block.index > firstLayerBlock) continue;

    // (2) every rule is the root guard.
    const allGuarded = block.rules.every(
      (rule) => compact(rule.prelude) === compact(DEFAULT_GUARD)
    );
    if (!allGuarded) continue;

    const open = css.indexOf('{', block.index);
    const close = matchBrace(css, open);
    if (open === -1 || close === -1) continue;

    // (3) no nested at-rule anywhere in the body — the span would otherwise
    // grant it blanket cover from the containment gate.
    if (/@[a-zA-Z-]/.test(css.slice(open + 1, close))) continue;

    spans.push([block.index, close]);
  }
  return spans;
}

export interface SystemSchemeGuardConfig {
  /**
   * OS schemes that MUST appear as guarded root blocks carrying at least one
   * custom property. Omit to arm the check without requiring presence (an
   * unconfigured app stays green); pass both to make it non-vacuous.
   */
  expectSchemes?: readonly OsScheme[];
  /** Guard selector the emitter writes. Defaults to the spec's. */
  guard?: string;
}

/**
 * The system fallback never fights an explicit mode.
 *
 * Spec contract ("Guarded system fallback emission"): the mapped modes'
 * variable assignments apply under the OS preference *only while the document
 * root carries no `data-color-mode` attribute*. So the thing that must carry
 * the guard is every ROOT-TARGETING rule inside a `prefers-color-scheme` media
 * block — not every `prefers-color-scheme` at-rule in the sheet.
 *
 * That distinction is load-bearing, not a loophole. An application may author
 * its own OS-preference condition (`_osDark` on a component), which emits an
 * unguarded `@media (prefers-color-scheme: dark) { .animus-… { … } }` block
 * that is entirely correct and must not trip this gate. `e2e/vite-app` ships
 * exactly such a block in the same stylesheet as the theme's guarded blocks,
 * which is what keeps this assertion honest in both directions.
 */
export function assertSystemSchemeGuard(
  css: string,
  config?: SystemSchemeGuardConfig
): void {
  const guard = config?.guard ?? DEFAULT_GUARD;
  const compactGuard = compact(guard);
  const blocks = schemeBlocks(css);

  const offenders: Array<{ scheme: string; selector: string; index: number }> =
    [];
  for (const block of blocks) {
    for (const rule of block.rules) {
      if (!targetsRoot(rule.prelude)) continue;
      if (compact(rule.prelude) === compactGuard) continue;
      offenders.push({
        scheme: block.scheme,
        selector: rule.prelude,
        index: rule.index,
      });
    }
  }
  if (offenders.length > 0) {
    throw new AssertionError(
      `assertSystemSchemeGuard: ${offenders.length} root-targeting rule(s) inside a prefers-color-scheme block lack the '${guard}' guard: ${offenders
        .map((o) => `${o.selector}@${o.index}`)
        .join(', ')}`,
      { offenders, guard }
    );
  }

  for (const scheme of config?.expectSchemes ?? []) {
    const guarded = blocks
      .filter((block) => block.scheme === scheme)
      .flatMap((block) => block.rules)
      .filter((rule) => compact(rule.prelude) === compactGuard);
    const withVariables = guarded.filter((rule) =>
      declarationList(rule.body).some((declaration) =>
        declaration.startsWith('--')
      )
    );
    if (withVariables.length === 0) {
      throw new AssertionError(
        `assertSystemSchemeGuard: expected a '@media (prefers-color-scheme: ${scheme})' block whose '${guard}' rule assigns custom properties, found none`,
        {
          scheme,
          guardedRuleCount: guarded.length,
          schemeBlockCount: blocks.length,
        }
      );
    }
  }
}

export interface ColorSchemeEmissionConfig {
  /** `color-scheme` expected on the `:root` variables block (initial mode). */
  root: string;
  /** Declared mode name → `color-scheme` expected on its attribute block. */
  modes: Readonly<Record<string, string>>;
  /** OS scheme → `color-scheme` expected inside that scheme's guarded block. */
  system?: Readonly<Partial<Record<OsScheme, string>>>;
}

/**
 * Spec contract "Browser color-scheme classification": a supplied
 * classification puts `color-scheme` on `:root`, on every declared mode's
 * attribute block, and inside each guarded media block — so native surfaces
 * (form controls, scrollbars, the canvas) track whichever mode is active,
 * including the OS-driven one.
 */
export function assertColorSchemeEmission(
  css: string,
  config: ColorSchemeEmissionConfig
): void {
  const declarationOf = (body: string): string | undefined =>
    declarationList(body)
      .find((declaration) => /^color-scheme\s*:/.test(declaration))
      ?.replace(/^color-scheme\s*:\s*/, '');

  const rootRule = styleRules(css).find(
    (rule) => compact(rule.prelude) === ':root'
  );
  if (!rootRule) {
    throw new AssertionError(
      'assertColorSchemeEmission: no `:root` rule found in the CSS'
    );
  }
  const rootScheme = declarationOf(rootRule.body);
  if (rootScheme !== config.root) {
    throw new AssertionError(
      `assertColorSchemeEmission: :root expected 'color-scheme: ${config.root}', found ${rootScheme ?? 'none'}`,
      { expected: config.root, found: rootScheme }
    );
  }

  for (const [mode, expected] of Object.entries(config.modes)) {
    const rule = modeRule(css, mode);
    if (!rule) {
      throw new AssertionError(
        `assertColorSchemeEmission: no '[data-color-mode="${mode}"]' block found`,
        { mode }
      );
    }
    const found = declarationOf(rule.body);
    if (found !== expected) {
      throw new AssertionError(
        `assertColorSchemeEmission: [data-color-mode="${mode}"] expected 'color-scheme: ${expected}', found ${found ?? 'none'}`,
        { mode, expected, found }
      );
    }
  }

  for (const [scheme, expected] of Object.entries(config.system ?? {})) {
    const guarded = schemeBlocks(css)
      .filter((block) => block.scheme === scheme)
      .flatMap((block) => block.rules)
      .filter((rule) => compact(rule.prelude) === compact(DEFAULT_GUARD));
    const found = guarded.map((rule) => declarationOf(rule.body));
    if (!found.includes(expected)) {
      throw new AssertionError(
        `assertColorSchemeEmission: guarded '(prefers-color-scheme: ${scheme})' block expected 'color-scheme: ${expected}', found ${found.join(', ') || 'no guarded block'}`,
        { scheme, expected, found }
      );
    }
  }
}

export interface SystemFallbackParityConfig {
  /** OS scheme → the declared mode name the theme maps it onto. */
  mapping: Readonly<Partial<Record<OsScheme, string>>>;
}

/**
 * Spec contract: the guarded media block's declarations are the mapped mode's
 * RAW values — "identical to its attribute block". Pinning byte-equality of the
 * two declaration lists is what makes the OS path and the explicit path
 * provably the same rendering, rather than two hand-kept-in-sync copies.
 *
 * Also pins "Fallback blocks follow the root block": `:root` must precede every
 * guarded block, because a fallback emitted ahead of `:root` would lose to the
 * initial mode's own root assignments at equal specificity.
 */
export function assertSystemFallbackParity(
  css: string,
  config: SystemFallbackParityConfig
): void {
  const rootRule = styleRules(css).find(
    (rule) => compact(rule.prelude) === ':root'
  );
  if (!rootRule) {
    throw new AssertionError(
      'assertSystemFallbackParity: no `:root` rule found in the CSS'
    );
  }

  const blocks = schemeBlocks(css);
  for (const [scheme, mode] of Object.entries(config.mapping)) {
    if (!mode) continue;
    const block = blocks.find((candidate) => candidate.scheme === scheme);
    if (!block) {
      throw new AssertionError(
        `assertSystemFallbackParity: no '@media (prefers-color-scheme: ${scheme})' block found`,
        { scheme, mode }
      );
    }
    if (block.index < rootRule.index) {
      throw new AssertionError(
        `assertSystemFallbackParity: the '(prefers-color-scheme: ${scheme})' fallback (offset ${block.index}) must follow the :root block (offset ${rootRule.index})`,
        { scheme, mediaIndex: block.index, rootIndex: rootRule.index }
      );
    }

    const guarded = block.rules.find(
      (rule) => compact(rule.prelude) === compact(DEFAULT_GUARD)
    );
    if (!guarded) {
      throw new AssertionError(
        `assertSystemFallbackParity: the '(prefers-color-scheme: ${scheme})' block has no '${DEFAULT_GUARD}' rule`,
        { scheme, selectors: block.rules.map((rule) => rule.prelude) }
      );
    }

    const attribute = modeRule(css, mode);
    if (!attribute) {
      throw new AssertionError(
        `assertSystemFallbackParity: no '[data-color-mode="${mode}"]' block to compare the '${scheme}' fallback against`,
        { scheme, mode }
      );
    }

    const fallbackDeclarations = declarationList(guarded.body);
    const modeDeclarations = declarationList(attribute.body);
    if (fallbackDeclarations.join(';') !== modeDeclarations.join(';')) {
      throw new AssertionError(
        `assertSystemFallbackParity: '(prefers-color-scheme: ${scheme})' declarations differ from '[data-color-mode="${mode}"]'`,
        {
          scheme,
          mode,
          onlyInFallback: fallbackDeclarations.filter(
            (declaration) => !modeDeclarations.includes(declaration)
          ),
          onlyInMode: modeDeclarations.filter(
            (declaration) => !fallbackDeclarations.includes(declaration)
          ),
        }
      );
    }
  }
}
