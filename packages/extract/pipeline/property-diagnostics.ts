import { parseInternalWire } from './internal-wire';
import {
  PROPERTY_DISCRETE_ANIMATION,
  PROPERTY_FALLBACK_CHAIN_SUPPRESSED,
  PROPERTY_FALLBACK_SUPPRESSED,
  PROPERTY_SELF_REFERENCE,
  PROPERTY_UNREGISTERED_ANIMATION,
  severityFor,
} from './manifest-diagnostics';
import { propertyRegistrations } from './property-registrations';

import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ProjectManifest } from './manifest-schema';
import type { PropertyRegistration } from './property-registrations';
import type { SystemConfig } from './system-config';

export interface CustomPropertyCheckInput {
  system: Pick<SystemConfig, 'variableCss' | 'contextualVarsJson'>;
  manifest: Pick<ProjectManifest, 'components'>;
  componentCss: string;
  globalCss: string;
}

/** The sheets with self-referencing declarations removed, and what the
 *  checks found. */
export interface CustomPropertyCheck {
  componentCss: string;
  globalCss: string;
  diagnostics: ManifestDiagnostic[];
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
 * Reports custom properties that will not behave as their CSS suggests:
 * a fallback an initial value suppresses, an animated property that cannot
 * interpolate, and a property that refers to itself, whose declaration is
 * removed. A system that emits no `@property` rule is left untouched.
 */
export function checkCustomProperties(
  input: CustomPropertyCheckInput
): CustomPropertyCheck {
  const registered = propertyRegistrations(input.system.variableCss);
  if (registered.size === 0) {
    return {
      componentCss: input.componentCss,
      globalCss: input.globalCss,
      diagnostics: [],
    };
  }
  const declared = declaredProperties(input.system.contextualVarsJson);
  const findings: Finding[] = [];
  const sheets = [
    { css: input.componentCss, owner: componentOwner(input.manifest) },
    { css: input.globalCss, owner: globalOwner },
  ].map(({ css, owner }) => {
    const parsed = declarations(css);
    const removed: Declaration[] = [];
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
      const where = owner(declaration);
      if (isSelfReference(declaration)) {
        removed.push(declaration);
        findings.push({
          code: PROPERTY_SELF_REFERENCE,
          property: declaration.property,
          message: `${declaration.property} resolves to var(${declaration.property}), a reference to itself, which makes it invalid; the declaration is not emitted. Give it a value other than its own name`,
          owner: where,
        });
        continue;
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
        findings.push({
          code: chain
            ? PROPERTY_FALLBACK_CHAIN_SUPPRESSED
            : PROPERTY_FALLBACK_SUPPRESSED,
          property: read.name,
          message: chain
            ? `var(${read.name}, ${read.fallback}) never reads its fallback chain: ${read.name} is registered with initial-value ${registration.initialValue}, which applies whenever it is unset. Remove the initial value or reorder the chain`
            : `var(${read.name}, ${read.fallback}) never uses its fallback: ${read.name} is registered with initial-value ${registration.initialValue}, which applies whenever it is unset`,
          owner: where,
        });
      }
      for (const animated of animatedProperties(declaration, discreteRules)) {
        if (!declared.has(animated.name)) continue;
        const reason = interpolationGap(registered.get(animated.name));
        if (reason === null) continue;
        findings.push(
          animated.discrete
            ? {
                code: PROPERTY_DISCRETE_ANIMATION,
                property: animated.name,
                message: `${animated.name} is transitioned with allow-discrete but ${reason}, so it flips at the midpoint instead of interpolating. Register it with a typed syntax`,
                owner: where,
              }
            : {
                code: PROPERTY_UNREGISTERED_ANIMATION,
                property: animated.name,
                message: `${animated.name} is ${animated.how} but ${reason}, so it changes in one step instead of interpolating. Register it with a typed syntax to animate it`,
                owner: where,
              }
        );
      }
    }
    return withoutDeclarations(css, removed);
  });
  return {
    componentCss: sheets[0],
    globalCss: sheets[1],
    diagnostics: toDiagnostics(findings),
  };
}

function declaredProperties(contextualVarsJson: string | null): Set<string> {
  if (!contextualVarsJson) return new Set();
  const byScale = parseInternalWire<Record<string, string[]>>(
    contextualVarsJson,
    "contextualVarsJson (the theme's contextual variable names)"
  );
  return new Set(
    Object.values(byScale).flatMap((names) => names.map((name) => `--${name}`))
  );
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

function isSelfReference(declaration: Declaration): boolean {
  return (
    declaration.property.startsWith('--') &&
    declaration.value.replace(/\s+/g, '') === `var(${declaration.property})`
  );
}

/** Every `var()` read in `value`, nested fallbacks included. */
function varReads(
  value: string
): Array<{ name: string; fallback: string | undefined }> {
  const reads: Array<{ name: string; fallback: string | undefined }> = [];
  for (const match of value.matchAll(/var\(\s*(--[\w-]+)\s*/g)) {
    const after = (match.index ?? 0) + match[0].length;
    if (value[after] !== ',') {
      reads.push({ name: match[1], fallback: undefined });
      continue;
    }
    let depth = 1;
    let close = after + 1;
    for (; close < value.length && depth > 0; close += 1) {
      if (value[close] === '(') depth += 1;
      else if (value[close] === ')') depth -= 1;
    }
    reads.push({
      name: match[1],
      fallback: value.slice(after + 1, close - 1).trim(),
    });
  }
  return reads;
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
  if (keyframes !== undefined && declaration.property.startsWith('--')) {
    return [
      {
        name: declaration.property,
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
  return topLevelItems(declaration.value).flatMap((item) =>
    (item.match(/--[\w-]+/g) ?? []).map((name) => ({
      name,
      how: 'transitioned',
      discrete:
        /\ballow-discrete\b/.test(item) || discreteRules.has(declaration.rule),
    }))
  );
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
  const components = Object.values(manifest.components);
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

/** Removes whole declarations, and their lines when nothing else is on them. */
function withoutDeclarations(
  css: string,
  removed: readonly Declaration[]
): string {
  let result = css;
  for (const declaration of [...removed].sort((a, b) => b.start - a.start)) {
    let start = declaration.start;
    let end = declaration.end;
    const lineStart = result.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = result.indexOf('\n', end);
    if (
      result.slice(lineStart, start).trim() === '' &&
      result.slice(end, lineEnd === -1 ? undefined : lineEnd).trim() === ''
    ) {
      start = lineStart;
      end = lineEnd === -1 ? result.length : lineEnd + 1;
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
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
