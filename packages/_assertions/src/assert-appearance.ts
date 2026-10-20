/**
 * Runs over BUILT CSS: minifiers drop attribute-value quotes and Lightning CSS
 * injects `--lightningcss-*` pairs into any rule declaring `color-scheme`.
 */
import { AssertionError, compact } from './assert-css';

export type OsScheme = 'light' | 'dark';

const DEFAULT_GUARD = ':root:not([data-color-mode])';

function declarationList(body: string): string[] {
  return body
    .split(';')
    .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
    .filter((declaration) => declaration !== '');
}

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
  prelude: string;
  body: string;
  index: number;
}

/**
 * Every style rule at any depth, with offsets into the original string.
 * At-rules are descended into rather than returned.
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
  index: number;
  rules: Rule[];
}

function schemeBlocks(css: string): SchemeBlock[] {
  const blocks: SchemeBlock[] = [];
  const openRe = /@media[^{]*prefers-color-scheme\s*:\s*(light|dark)[^{]*\{/g;
  for (const match of css.matchAll(openRe)) {
    if (match.index === undefined) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBrace(css, open);
    if (close === -1) continue;
    blocks.push({
      // SAFETY: group 1 of `openRe` is a non-optional `(light|dark)`
      // alternation, so a match carries one of the two `OsScheme` spellings.
      scheme: match[1] as OsScheme,
      index: match.index,
      rules: styleRules(css.slice(open + 1, close), open + 1),
    });
  }
  return blocks;
}

/**
 * True when a comma-part of `selector` targets `:root`, the only root spelling
 * the theme emitter writes; a bare `html` rule is the application's own.
 */
function targetsRoot(selector: string): boolean {
  return selector
    .split(',')
    .some((part) => /(^|[\s>+~]):root\b/.test(part.trim()));
}

/**
 * The initial mode's attribute rule when it also carries the guard: the theme
 * emitter folds that mode's system-preference block into it, so it is the
 * fallback for the scheme no media block covers, and must precede the media
 * block that covers the other.
 */
function foldedFallback(
  css: string,
  guard = DEFAULT_GUARD
): { mode: string; rule: Rule } | undefined {
  const inScheme = schemeBlocks(css).map(
    (block) =>
      [block.index, matchBrace(css, css.indexOf('{', block.index))] as const
  );
  for (const rule of styleRules(css)) {
    if (
      inScheme.some(([open, close]) => rule.index > open && rule.index < close)
    ) {
      continue;
    }
    const parts = rule.prelude.split(',').map((part) => compact(part));
    if (parts.length !== 2 || !parts.includes(compact(guard))) continue;
    const mode = /^\[data-color-mode=["']?([\w-]+)["']?\]$/.exec(
      parts.find((part) => part !== compact(guard)) ?? ''
    );
    if (mode) return { mode: mode[1], rule };
  }
  return undefined;
}

/** A scheme block's rules that carry exactly the guard. */
function guardedRules(block: SchemeBlock, guard = DEFAULT_GUARD): Rule[] {
  return block.rules.filter((rule) => compact(rule.prelude) === compact(guard));
}

/** The custom properties a rule body declares, by name. */
function customProperties(body: string): string[] {
  return declarationList(body)
    .filter((declaration) => declaration.startsWith('--'))
    .map((declaration) => declaration.split(':')[0].trim());
}

/** The folded fallback, when it serves `scheme`: no guarded media block
 *  covers `scheme`, and the other scheme's guarded block follows the fold and
 *  declares every custom property it does, so it overrides each one under
 *  the other preference. A component's own scheme conditions are not
 *  fallbacks. */
function foldedFallbackFor(
  css: string,
  scheme: OsScheme,
  guard = DEFAULT_GUARD
): { mode: string; rule: Rule } | undefined {
  const fallbacks = schemeBlocks(css).filter(
    (block) => guardedRules(block, guard).length > 0
  );
  if (fallbacks.some((block) => block.scheme === scheme)) return undefined;
  const folded = foldedFallback(css, guard);
  if (
    !folded ||
    fallbacks.length === 0 ||
    fallbacks.some((block) => block.index < folded.rule.index)
  ) {
    return undefined;
  }
  const overridden = new Set(
    fallbacks
      .flatMap((block) => guardedRules(block, guard))
      .flatMap((rule) => customProperties(rule.body))
  );
  return customProperties(folded.rule.body).every((name) =>
    overridden.has(name)
  )
    ? folded
    : undefined;
}

function modeRule(css: string, mode: string): Rule | undefined {
  const re = new RegExp(
    `\\[data-color-mode\\s*=\\s*["']?${mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\]`
  );
  return styleRules(css).find((rule) => re.test(rule.prelude));
}

/**
 * Spans of the theme's unlayered `prefers-color-scheme` fallback blocks, which
 * sit beside `:root` so variable resolution stays out of the layer order.
 */
export function systemSchemeVariableSpans(css: string): [number, number][] {
  const firstLayerBlock = css.match(/@layer\s+[\w-]+\s*\{/)?.index ?? -1;

  const spans: [number, number][] = [];
  for (const block of schemeBlocks(css)) {
    if (block.rules.length === 0) continue;

    if (firstLayerBlock !== -1 && block.index > firstLayerBlock) continue;

    const allGuarded = block.rules.every(
      (rule) => compact(rule.prelude) === compact(DEFAULT_GUARD)
    );
    if (!allGuarded) continue;

    const open = css.indexOf('{', block.index);
    const close = matchBrace(css, open);
    if (open === -1 || close === -1) continue;

    // A nested at-rule forfeits the exemption: the span would otherwise grant
    // it blanket cover from the containment gate.
    if (/@[a-zA-Z-]/.test(css.slice(open + 1, close))) continue;

    spans.push([block.index, close]);
  }
  return spans;
}

export interface SystemSchemeGuardConfig {
  /**
   * OS schemes that must appear as guarded root blocks assigning at least one
   * custom property. Omitting it leaves the presence check unarmed.
   */
  expectSchemes?: readonly OsScheme[];
  guard?: string;
}

/**
 * Every ROOT-targeting rule inside a `prefers-color-scheme` block carries the
 * guard, so the fallback never fights an explicit mode; other rules are free.
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
    const folded = foldedFallbackFor(css, scheme, guard);
    const guarded = [
      ...blocks
        .filter((block) => block.scheme === scheme)
        .flatMap((block) => guardedRules(block, guard)),
      ...(folded ? [folded.rule] : []),
    ];
    const withVariables = guarded.filter(
      (rule) => customProperties(rule.body).length > 0
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
  root: string;
  modes: Readonly<Record<string, string>>;
  system?: Readonly<Partial<Record<OsScheme, string>>>;
}

/**
 * `color-scheme` is emitted on `:root`, on every declared mode's attribute
 * block, and inside each guarded media block, so native surfaces track it.
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
      { expected: config.root, found: rootScheme ?? null }
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
        { mode, expected, found: found ?? null }
      );
    }
  }

  for (const [scheme, expected] of Object.entries(config.system ?? {})) {
    // SAFETY: `system` is keyed by `OsScheme`; entries widen it to string.
    const folded = foldedFallbackFor(css, scheme as OsScheme);
    const guarded = [
      ...schemeBlocks(css)
        .filter((block) => block.scheme === scheme)
        .flatMap((block) => guardedRules(block)),
      ...(folded ? [folded.rule] : []),
    ];
    const found = guarded.map((rule) => declarationOf(rule.body));
    if (!found.includes(expected)) {
      throw new AssertionError(
        `assertColorSchemeEmission: guarded '(prefers-color-scheme: ${scheme})' block expected 'color-scheme: ${expected}', found ${found.join(', ') || 'no guarded block'}`,
        {
          scheme,
          expected,
          found: found.map((declaration) => declaration ?? null),
        }
      );
    }
  }
}

export interface SystemFallbackParityConfig {
  mapping: Readonly<Partial<Record<OsScheme, string>>>;
}

/**
 * A guarded fallback block's declarations equal its mapped mode's attribute
 * block, and follow `:root` — ahead of it they lose at equal specificity.
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
    // The theme's fallback block, not a component's own scheme condition.
    const block =
      blocks.find(
        (candidate) =>
          candidate.scheme === scheme && guardedRules(candidate).length > 0
      ) ?? blocks.find((candidate) => candidate.scheme === scheme);
    // SAFETY: `mapping` is keyed by `OsScheme`; entries widen it to string.
    const folded = foldedFallbackFor(css, scheme as OsScheme);
    if (folded) {
      // The fold is the mode's own attribute rule, so parity holds by
      // construction; what remains is that it names this mode and follows
      // `:root`.
      if (folded.mode !== mode || folded.rule.index < rootRule.index) {
        throw new AssertionError(
          `assertSystemFallbackParity: the folded '${scheme}' fallback names '${folded.mode}' (offset ${folded.rule.index}), expected '${mode}' after :root (offset ${rootRule.index})`,
          { scheme, mode, folded: folded.mode, rootIndex: rootRule.index }
        );
      }
      continue;
    }
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
