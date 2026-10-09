import {
  PROPERTY_FALLBACK_CHAIN_SUPPRESSED,
  PROPERTY_FALLBACK_SELF_REFERENCE,
  PROPERTY_FALLBACK_SUPPRESSED,
  PROPERTY_SELF_REFERENCE,
  PROPERTY_UNREGISTERED_ANIMATION,
  severityFor,
} from './manifest-diagnostics';
import { readCustomPropertyName } from './property-names';
import { propertyRegistrations } from './property-registrations';

import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ProjectManifest } from './manifest-schema';
import type { PropertyRegistration } from './property-registrations';
import type { SystemConfig } from './system-config';

export interface CustomPropertyCheckInput {
  system: Pick<SystemConfig, 'variableCss' | 'contextualProperties'>;
  manifest: Pick<ProjectManifest, 'components'>;
  componentCss: string;
  globalCss: string;
}

interface Declaration {
  property: string;
  value: string;
  /** Offsets of the declaration text, its `;` included when present. */
  start: number;
  end: number;
  /** The enclosing rule, unique within one sheet. */
  rule: number;
  /** Enclosing preludes, outermost first. */
  context: readonly string[];
}

interface Finding {
  code: string;
  property: string;
  message: string;
  owner: { file: string; component: string };
}

/**
 * Reports custom properties that will not behave as their CSS suggests: a
 * property that refers to itself, a fallback a registered initial value
 * applies ahead of, and an animated property that cannot interpolate. Names
 * are read as CSS tokenizes them, so escapes, function case, comments and
 * quoted text match the prefix pass. The CSS itself is never changed.
 */
export function checkCustomProperties(
  input: CustomPropertyCheckInput
): ManifestDiagnostic[] {
  const registered = propertyRegistrations(input.system.variableCss);
  const declared = new Set(input.system.contextualProperties ?? []);
  const findings: Finding[] = [];
  const sheets = [
    { css: input.componentCss, owner: componentOwner(input.manifest) },
    { css: input.globalCss, owner: globalOwner },
  ];
  for (const { css, owner } of sheets) {
    // A sheet that reads no variable and animates nothing has no finding,
    // which the text shows before any declaration is parsed.
    if (!/var\(|transition|@keyframes/i.test(css)) continue;
    const parsed = declarations(css);
    const discreteRules = new Set(
      parsed
        .filter(
          (d) =>
            d.property === 'transition-behavior' &&
            /\ballow-discrete\b/.test(d.value)
        )
        .map((d) => d.rule)
    );
    for (const declaration of parsed) {
      // The owner is looked up only for a finding: scanning every component
      // for every declaration costs more than the checks themselves.
      const found = (code: string, property: string, message: string) =>
        findings.push({ code, property, message, owner: owner(declaration) });
      if (isSelfReference(declaration)) {
        found(
          PROPERTY_SELF_REFERENCE,
          declaration.property,
          `${declaration.property} resolves to var(${declaration.property}), a reference to itself, so it is invalid at computed-value time. Give it a value other than its own name`
        );
        continue;
      }
      if (readsItselfOnlyInFallback(declaration)) {
        found(
          PROPERTY_FALLBACK_SELF_REFERENCE,
          declaration.property,
          `${declaration.property}: ${declaration.value} reads ${declaration.property} only inside another var()'s fallback, so the result depends on how the browser treats fallback references: one that evaluates a fallback only when it is used keeps the value, one that counts every reference makes ${declaration.property} cyclic and invalid at computed-value time`
        );
      }
      for (const read of varReads(declaration.value)) {
        const registration = registered.get(read.name);
        if (
          read.fallback === undefined ||
          registration?.initialValue === undefined
        ) {
          continue;
        }
        const chain = read.fallback.startsWith('var(');
        found(
          chain
            ? PROPERTY_FALLBACK_CHAIN_SUPPRESSED
            : PROPERTY_FALLBACK_SUPPRESSED,
          read.name,
          `var(${read.name}, ${read.fallback}): where its registration applies, ${read.name}'s initial-value ${registration.initialValue} is used ahead of the ${chain ? 'fallback chain' : 'fallback'} whenever ${read.name} is unset; the fallback still serves browsers without the registration`
        );
      }
      for (const animated of animatedProperties(declaration, discreteRules)) {
        // `allow-discrete` states that a discrete step is intended.
        if (animated.discrete || !declared.has(animated.name)) continue;
        const reason = interpolationGap(registered.get(animated.name));
        if (reason === null) continue;
        found(
          PROPERTY_UNREGISTERED_ANIMATION,
          animated.name,
          `${animated.name} is ${animated.how} but ${reason}, so it changes in one step instead of interpolating. Register it with a typed syntax to animate it`
        );
      }
    }
  }
  return toDiagnostics(findings);
}

/** Declarations in engine-emitted CSS: one `property: value` per `;`. */
function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  const stack: Array<{ prelude: string; rule: number }> = [];
  let rules = 0;
  let segment = 0;
  let parens = 0;
  let quote: string | null = null;
  const take = (end: number) => {
    const text = css.slice(segment, end);
    const colon = text.indexOf(':');
    const current = stack[stack.length - 1];
    if (current === undefined || colon <= 0) return;
    found.push({
      property: text.slice(0, colon).trim(),
      value: text
        .slice(colon + 1)
        .replace(/;$/, '')
        .trim(),
      start: segment + (text.length - text.trimStart().length),
      end,
      rule: current.rule,
      context: stack.map((entry) => entry.prelude),
    });
  };
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') parens += 1;
    else if (c === ')') parens -= 1;
    else if (parens === 0 && c === '{') {
      stack.push({ prelude: css.slice(segment, i).trim(), rule: rules });
      rules += 1;
      segment = i + 1;
    } else if (parens === 0 && c === ';') {
      take(i + 1);
      segment = i + 1;
    } else if (parens === 0 && c === '}') {
      take(i);
      stack.pop();
      segment = i + 1;
    }
  }
  return found;
}

/** `text` as a whole custom-property name, escapes decoded; `undefined`
 *  when it is not one. */
function customPropertyName(text: string): string | undefined {
  if (!text.startsWith('--')) return undefined;
  const { end, name } = readCustomPropertyName(text, 2);
  return end === text.length ? `--${name}` : undefined;
}

function isSelfReference(declaration: Declaration): boolean {
  const property = customPropertyName(declaration.property);
  const reads = varReads(declaration.value);
  return (
    property !== undefined &&
    reads.length === 1 &&
    reads[0].name === property &&
    reads[0].fallback === undefined &&
    withoutComments(declaration.value).trim() ===
      withoutComments(
        declaration.value.slice(reads[0].start, reads[0].end)
      ).trim()
  );
}

/** Whether every read of the declared property sits inside another read's
 *  fallback, as in `--a: var(--b, var(--a))`. */
function readsItselfOnlyInFallback(declaration: Declaration): boolean {
  const property = customPropertyName(declaration.property);
  if (property === undefined) return false;
  const reads = varReads(declaration.value);
  const own = reads.filter((read) => read.name === property);
  return (
    own.length > 0 &&
    own.every((read) =>
      reads.some(
        (outer) =>
          outer !== read && outer.start < read.start && read.end <= outer.end
      )
    )
  );
}

/** A `var()` read: the decoded name, its fallback, and the call's offsets. */
interface VarRead {
  name: string;
  fallback: string | undefined;
  start: number;
  end: number;
}

/** Every `var()` read in `value`, nested fallbacks included, in any case
 *  and spacing. Quoted text and comments hold none. */
function varReads(value: string): VarRead[] {
  const reads: VarRead[] = [];
  for (let at = 0; at < value.length;) {
    const c = value[at];
    if (c === '"' || c === "'") {
      at = closingQuote(value, at);
      continue;
    }
    if (value.startsWith('/*', at)) {
      at = skipSpace(value, at);
      continue;
    }
    if (
      value.slice(at, at + 4).toLowerCase() !== 'var(' ||
      /[\w-]/.test(value[at - 1] ?? '')
    ) {
      at += 1;
      continue;
    }
    const nameAt = skipSpace(value, at + 4);
    if (!value.startsWith('--', nameAt)) {
      at += 4;
      continue;
    }
    const { end: nameEnd, name } = readCustomPropertyName(value, nameAt + 2);
    const after = skipSpace(value, nameEnd);
    const close = closingParen(value, at + 4);
    reads.push({
      name: `--${name}`,
      fallback:
        value[after] === ','
          ? value.slice(after + 1, close - 1).trim()
          : undefined,
      start: at,
      end: close,
    });
    // Reads inside the fallback are found on the next steps.
    at = after;
  }
  return reads;
}

/** The index after the `)` that closes the call whose arguments start at
 *  `from`. Quoted text and comments are skipped. */
function closingParen(value: string, from: number): number {
  let depth = 1;
  let at = from;
  while (at < value.length && depth > 0) {
    const c = value[at];
    if (c === '"' || c === "'") at = closingQuote(value, at);
    else if (value.startsWith('/*', at)) at = skipSpace(value, at);
    else {
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      at += 1;
    }
  }
  return at;
}

function closingQuote(value: string, open: number): number {
  let at = open + 1;
  while (at < value.length && value[at] !== value[open]) {
    at += value[at] === '\\' ? 2 : 1;
  }
  return Math.min(at + 1, value.length);
}

/** The index after CSS whitespace and comments starting at `from`. */
function skipSpace(value: string, from: number): number {
  let at = from;
  for (;;) {
    while (/[ \t\n\r\f]/.test(value[at] ?? '')) at += 1;
    if (!value.startsWith('/*', at)) return at;
    const close = value.indexOf('*/', at + 2);
    at = close === -1 ? value.length : close + 2;
  }
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Custom properties this declaration sets in a keyframe or names in a
 *  transition. */
function animatedProperties(
  declaration: Declaration,
  discreteRules: ReadonlySet<number>
): Array<{ name: string; how: string; discrete: boolean }> {
  const keyframes = declaration.context.find((prelude) =>
    prelude.startsWith('@keyframes')
  );
  const set = customPropertyName(declaration.property);
  if (keyframes !== undefined && set !== undefined) {
    return [
      {
        name: set,
        how: `set in ${keyframes}`,
        discrete: false,
      },
    ];
  }
  if (
    declaration.property !== 'transition' &&
    declaration.property !== 'transition-property'
  ) {
    return [];
  }
  // A bare `--x` names the item's property wherever it stands, before or
  // after its duration; a value read from a variable sits inside var().
  return topLevelItems(declaration.value).flatMap((item) => {
    const property = topLevelTokens(item.replace(/\/\*[\s\S]*?\*\//g, ' '))
      .map(customPropertyName)
      .find((name) => name !== undefined);
    return property !== undefined
      ? [
          {
            name: property,
            how: 'transitioned',
            discrete:
              /\ballow-discrete\b/.test(item) ||
              discreteRules.has(declaration.rule),
          },
        ]
      : [];
  });
}

/** The whitespace-separated tokens of `item` outside any parentheses. */
function topLevelTokens(item: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let token = '';
  for (const c of item) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (depth === 0 && /\s/.test(c)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += c;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function topLevelItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') depth -= 1;
    else if (value[i] === ',' && depth === 0) {
      items.push(value.slice(start, i));
      start = i + 1;
    }
  }
  items.push(value.slice(start));
  return items;
}

/** Why a property cannot interpolate, or `null` when it can. */
function interpolationGap(
  registration: PropertyRegistration | undefined
): string | null {
  if (registration === undefined) return 'it is not registered';
  if (registration.syntax === '*') {
    return 'it is registered with the universal syntax "*"';
  }
  return null;
}

function componentOwner(
  manifest: Pick<ProjectManifest, 'components'>
): (declaration: Declaration) => Finding['owner'] {
  const components = Object.values(manifest.components ?? {});
  return (declaration) => {
    const selector = [...declaration.context]
      .reverse()
      .find((prelude) => !prelude.startsWith('@'));
    const classes = (selector ?? '').match(/\.-?[_a-zA-Z][\w-]*/g) ?? [];
    for (const dotted of classes) {
      const name = dotted.slice(1);
      const owner = components.find(
        (component) =>
          name === component.class_name ||
          name.startsWith(`${component.class_name}--`) ||
          component.replacement.includes(`"${name}"`)
      );
      if (owner) return { file: owner.file, component: owner.binding };
    }
    return { file: 'styles', component: selector ?? 'stylesheet' };
  };
}

function globalOwner(declaration: Declaration): Finding['owner'] {
  const keyframes = declaration.context.find((prelude) =>
    prelude.startsWith('@keyframes')
  );
  const selector = [...declaration.context]
    .reverse()
    .find((prelude) => !prelude.startsWith('@'));
  return {
    file: 'system',
    component: keyframes ?? selector ?? 'global styles',
  };
}

/** One diagnostic per code, property and owner. */
function toDiagnostics(findings: readonly Finding[]): ManifestDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: ManifestDiagnostic[] = [];
  for (const finding of findings) {
    const key = `${finding.code}|${finding.property}|${finding.owner.file}|${finding.owner.component}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      file: finding.owner.file,
      component: finding.owner.component,
      kind: 'warn',
      message: `${finding.message} (${finding.code})`,
      code: finding.code,
      severity: severityFor(finding.code),
    });
  }
  return diagnostics;
}
