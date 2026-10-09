import {
  componentValues,
  isSpace,
  someValue,
  tokenize,
  variableReads,
} from '@animus-ui/properties';

import {
  PROPERTY_FALLBACK_CHAIN_SUPPRESSED,
  PROPERTY_FALLBACK_SELF_REFERENCE,
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
import type {
  ComponentValue,
  CssToken,
  VariableRead,
} from '@animus-ui/properties';

export interface CustomPropertyCheckInput {
  system: Pick<SystemConfig, 'variableCss' | 'contextualProperties'>;
  manifest: Pick<ProjectManifest, 'components'>;
  componentCss: string;
  globalCss: string;
}

interface Declaration {
  /** A custom property's decoded name, or any other property's name
   *  lowercased. */
  property: string;
  custom: boolean;
  /** As written, without surrounding whitespace. */
  value: string;
  /** The value's component values, without surrounding whitespace. */
  values: readonly ComponentValue[];
  /** The enclosing rule, unique within one sheet. */
  rule: number;
  /** Enclosing preludes, outermost first, without comments. */
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
 * applies ahead of, and an animated property that cannot interpolate. Sheets
 * are read through the shared CSS tokenizer, as the prefix pass reads them:
 * comments are trivia, quoted text holds no names, and escapes and function
 * case are decoded. The CSS itself is never changed.
 */
export function checkCustomProperties(
  input: CustomPropertyCheckInput
): ManifestDiagnostic[] {
  const registered = propertyRegistrations(input.system.variableCss);
  const declaredNames = input.system.contextualProperties ?? [];
  const declared = new Set(declaredNames);
  const withInitialValue = [...registered]
    .filter(([, registration]) => registration.initialValue !== undefined)
    .map(([name]) => name);
  const findings: Finding[] = [];
  const sheets = [
    { css: input.componentCss, owner: componentOwner(input.manifest) },
    { css: input.globalCss, owner: globalOwner },
  ];
  for (const { css, owner } of sheets) {
    if (!mayHoldFinding(css, withInitialValue, declaredNames)) continue;
    const parsed = declarations(css);
    const discreteRules = new Set(
      parsed
        .filter(
          (d) =>
            d.property === 'transition-behavior' &&
            topLevelItems(d.values).some(isDiscrete)
        )
        .map((d) => d.rule)
    );
    for (const declaration of parsed) {
      // The owner is looked up only for a finding: scanning every component
      // for every declaration costs more than the checks themselves.
      const found = (code: string, property: string, message: string) =>
        findings.push({ code, property, message, owner: owner(declaration) });
      const reads = variableReads(declaration.values);
      if (isSelfReference(declaration, reads)) {
        found(
          PROPERTY_SELF_REFERENCE,
          declaration.property,
          `${declaration.property} resolves to var(${declaration.property}), a reference to itself, so it is invalid at computed-value time. Give it a value other than its own name`
        );
        continue;
      }
      if (readsItselfOnlyInFallback(declaration, reads)) {
        const { property, value } = declaration;
        found(
          PROPERTY_FALLBACK_SELF_REFERENCE,
          property,
          `${property}: ${value} reads ${property} inside another var()'s fallback. Wherever that fallback is used, ${property} refers to itself, a cycle in every browser, so ${property} is invalid at computed-value time, or takes its registered initial value, and so is every property that reads it; where it is not used, browsers differ on whether the cycle still counts. Without this declaration, descendants read the inherited ${property} instead, also where the outer variable is set, which is what a prop with currentVar does for such a value`
        );
      }
      for (const read of reads) {
        const registration = registered.get(read.name);
        if (
          read.fallback === undefined ||
          registration?.initialValue === undefined
        ) {
          continue;
        }
        const { fallback } = read;
        const chain = reads.some((other) => other.start === fallback.first);
        found(
          chain
            ? PROPERTY_FALLBACK_CHAIN_SUPPRESSED
            : PROPERTY_FALLBACK_SUPPRESSED,
          read.name,
          `var(${read.name}, ${css.slice(fallback.start, fallback.end).trim()}): where its registration applies, ${read.name}'s initial-value ${registration.initialValue} is used ahead of the ${chain ? 'fallback chain' : 'fallback'} whenever ${read.name} is unset; the fallback still serves browsers without the registration`
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

/**
 * Whether a sheet can hold a finding, shown by its text before anything is
 * parsed: a custom property reading its own name, a `var(` with a fallback
 * of a registration that has an initial value, or a transition or keyframes
 * and a declared contextual variable's name. An escape or a comment can hide
 * a name or a function from the text, so a sheet with either is always
 * parsed.
 */
function mayHoldFinding(
  css: string,
  withInitialValue: readonly string[],
  declared: readonly string[]
): boolean {
  return (
    css.includes('\\') ||
    css.includes('/*') ||
    readsOwnName(css) ||
    withInitialValue.some((name) =>
      new RegExp(String.raw`var\(\s*${escapeRegExp(name)}\s*,`, 'i').test(css)
    ) ||
    (declared.some((name) => css.includes(name)) &&
      /transition|@keyframes/i.test(css))
  );
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A custom-property declaration key, as the text shows one: anything but
 *  CSS whitespace and the characters that end a name, so a non-ASCII space
 *  stays part of the name, as CSS reads it. */
const CUSTOM_PROPERTY_KEY = /(--[^\t\n\f\r :;{}()"'\\/]+)[\t\n\f\r ]*:/g;

const VAR_OPEN = /var\(\s*/iy;

const isNameCode = (c: number) =>
  (c >= 0x30 && c <= 0x39) ||
  (c >= 0x41 && c <= 0x5a) ||
  (c >= 0x61 && c <= 0x7a) ||
  c === 0x2d ||
  c === 0x5f ||
  c >= 0x80;

/**
 * Whether a custom-property declaration has `var(` of its own whole name in
 * its value, bounded as the declaration scanner bounds one: by a `;`, `{` or
 * `}` outside parentheses, brackets and quoted text. `var` matches in any
 * case, so this errs toward parsing.
 */
function readsOwnName(css: string): boolean {
  for (const match of css.matchAll(CUSTOM_PROPERTY_KEY)) {
    const name = match[1];
    let depth = 0;
    let quote = -1;
    for (let i = match.index + match[0].length; i < css.length; i += 1) {
      const c = css.charCodeAt(i);
      if (quote !== -1) {
        // A newline ends a quoted string, as it does for the tokenizer.
        if (c === quote || c === 0x0a || c === 0x0d || c === 0x0c) quote = -1;
      } else if (c === 0x22 || c === 0x27) {
        quote = c;
      } else if (c === 0x28 || c === 0x5b) {
        depth += 1;
      } else if (c === 0x29 || c === 0x5d) {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && (c === 0x3b || c === 0x7b || c === 0x7d)) {
        break;
      } else if (c === 0x76 || c === 0x56) {
        VAR_OPEN.lastIndex = i;
        const at = VAR_OPEN.test(css) ? VAR_OPEN.lastIndex : -1;
        if (
          at !== -1 &&
          css.startsWith(name, at) &&
          !isNameCode(css.charCodeAt(at + name.length))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** `items` as text without comments, at-keywords decoded. */
function textOf(css: string, items: readonly ComponentValue[]): string {
  let text = '';
  const add = (token: CssToken) => {
    if (token.type === 'whitespace') text += ' ';
    else if (token.type === 'at-keyword')
      text += `@${token.value.toLowerCase()}`;
    else text += css.slice(token.start, token.end);
  };
  const walk = (list: readonly ComponentValue[]) => {
    for (const item of list) {
      if (item.kind === 'token') {
        add(item.token);
      } else {
        add(item.open);
        walk(item.children);
        if (item.close) add(item.close);
      }
    }
  };
  walk(items);
  return text.trim();
}

/** Declarations in a sheet: one `property: value` per `;` inside a `{}`
 *  block, read from component values, so comments separate nothing. */
function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  let rules = 0;
  const visit = (
    items: readonly ComponentValue[],
    context: readonly string[],
    rule: number | undefined
  ) => {
    let segment: ComponentValue[] = [];
    const take = () => {
      const declaration = declarationOf(css, segment);
      if (rule !== undefined && declaration !== undefined) {
        found.push({ ...declaration, rule, context });
      }
      segment = [];
    };
    for (const item of items) {
      if (item.kind === 'block' && item.open.type === '{') {
        const prelude = textOf(css, segment);
        segment = [];
        rules += 1;
        visit(item.children, [...context, prelude], rules - 1);
      } else if (item.kind === 'token' && item.token.type === ';') {
        take();
      } else {
        segment.push(item);
      }
    }
    take();
  };
  visit(componentValues(tokenize(css)), [], undefined);
  return found;
}

/** The declaration a `;`-separated segment holds, if any. A bad string or
 *  url makes a declaration invalid, so browsers drop it, and so does this. */
function declarationOf(
  css: string,
  segment: readonly ComponentValue[]
): Omit<Declaration, 'rule' | 'context'> | undefined {
  const colon = segment.findIndex(
    (item) => item.kind === 'token' && item.token.type === ':'
  );
  const named = segment.slice(0, Math.max(colon, 0)).filter((i) => !isSpace(i));
  const values = trimSpace(segment.slice(colon + 1));
  if (
    colon === -1 ||
    named.length === 0 ||
    someValue(
      values,
      (v) =>
        v.kind === 'token' &&
        (v.token.type === 'bad-url' || v.token.type === 'bad-string')
    )
  ) {
    return undefined;
  }
  const [only] = named;
  const ident =
    named.length === 1 && only.kind === 'token' && only.token.type === 'ident'
      ? only.token.value
      : undefined;
  const custom = ident?.startsWith('--') === true;
  return {
    property:
      custom && ident !== undefined
        ? ident
        : (ident ?? textOf(css, named)).toLowerCase(),
    custom,
    value:
      values.length > 0
        ? css.slice(values[0].start, values[values.length - 1].end)
        : '',
    values,
  };
}

function trimSpace(items: readonly ComponentValue[]): ComponentValue[] {
  let start = 0;
  let end = items.length;
  while (start < end && isSpace(items[start])) start += 1;
  while (end > start && isSpace(items[end - 1])) end -= 1;
  return items.slice(start, end);
}

/** Whether the value is exactly `var()` of the declared property. */
function isSelfReference(
  declaration: Declaration,
  reads: readonly VariableRead[]
): boolean {
  return (
    declaration.custom &&
    reads.length === 1 &&
    reads[0].name === declaration.property &&
    reads[0].fallback === undefined &&
    declaration.values.length === 1 &&
    declaration.values[0].start === reads[0].start
  );
}

/** Whether every read of the declared property sits inside another read's
 *  fallback, as in `--a: var(--b, var(--a))`. */
function readsItselfOnlyInFallback(
  declaration: Declaration,
  reads: readonly VariableRead[]
): boolean {
  if (!declaration.custom) return false;
  const own = reads.filter((read) => read.name === declaration.property);
  return (
    own.length > 0 &&
    own.every((read) =>
      reads.some(
        (outer) =>
          outer.fallback !== undefined &&
          outer.fallback.start <= read.start &&
          read.end <= outer.fallback.end
      )
    )
  );
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
  if (keyframes !== undefined && declaration.custom) {
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
  // A bare `--x` names the item's property wherever it stands, before or
  // after its duration; a value read from a variable sits inside var().
  return topLevelItems(declaration.values).flatMap((item) => {
    const named = item.find(
      (value) =>
        value.kind === 'token' &&
        value.token.type === 'ident' &&
        value.token.value.startsWith('--')
    );
    return named?.kind === 'token'
      ? [
          {
            name: named.token.value,
            how: 'transitioned',
            discrete: isDiscrete(item) || discreteRules.has(declaration.rule),
          },
        ]
      : [];
  });
}

function isDiscrete(item: readonly ComponentValue[]): boolean {
  return item.some(
    (value) =>
      value.kind === 'token' &&
      value.token.type === 'ident' &&
      value.token.value.toLowerCase() === 'allow-discrete'
  );
}

/** The comma-separated items of a value, each its top-level values. */
function topLevelItems(values: readonly ComponentValue[]): ComponentValue[][] {
  const items: ComponentValue[][] = [[]];
  for (const value of values) {
    if (value.kind === 'token' && value.token.type === ',') items.push([]);
    else items[items.length - 1].push(value);
  }
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
