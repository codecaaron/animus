import {
  dependsOnContext,
  foldInitialValue,
  identifierAt,
  substitutesValue,
} from '@animus-ui/properties';
import { transform as lcssTransform } from 'lightningcss';

import type { FoldedInitialValue } from '@animus-ui/properties';

/** A theme `@property` registration that browsers would ignore. */
export interface InvalidPropertyRegistration {
  name: string;
  reason: string;
}

const PROPERTY_AT_RULE = /@property\s+/gi;
const RULE_BODY = /\s*\{[^}]*\}\n?/y;

/** Each `@property` rule, through one newline after it, with its name read
 *  as CSS tokenizes an identifier: escapes decoded, non-ASCII included. */
function propertyRules(
  css: string
): Array<{ start: number; end: number; name: string }> {
  const rules: Array<{ start: number; end: number; name: string }> = [];
  for (const match of css.matchAll(PROPERTY_AT_RULE)) {
    // Text inside a rule, such as a quoted initial value, starts none.
    if (match.index < (rules.at(-1)?.end ?? 0)) continue;
    const name = identifierAt(css, match.index + match[0].length);
    if (!name?.name.startsWith('--')) continue;
    RULE_BODY.lastIndex = name.end;
    const body = RULE_BODY.exec(css);
    if (body === null) continue;
    rules.push({
      start: match.index,
      end: name.end + body[0].length,
      name: name.name,
    });
  }
  return rules;
}

/** The data types a registration's `syntax` may name. */
const SYNTAX_TYPES = new Set([
  'angle',
  'color',
  'custom-ident',
  'image',
  'integer',
  'length',
  'length-percentage',
  'number',
  'percentage',
  'resolution',
  'string',
  'time',
  'transform-function',
  'transform-list',
  'url',
]);

const SYNTAX_COMPONENT = /^(?:<([a-z-]+)>[+#]?|-?[a-zA-Z_][\w-]*)$/;

const INITIAL_VALUE = /(initial-value\s*:\s*)([^;}]*)/;

const MATH_FUNCTION = /\b(?:calc|min|max|clamp)\(/i;

/**
 * Removes the `@property` rules browsers would ignore — an unknown syntax
 * component, a syntax other than `*` without an initial value, an initial
 * value that substitutes another value or depends on context, math that
 * breaks calculation syntax, or a value the syntax does not accept.
 * Minifying a stylesheet that contains such a rule can also fail. An
 * all-absolute math initial value is written as its computed value, which
 * the minifier reads.
 */
export function splitInvalidPropertyRegistrations(css: string) {
  const invalid: InvalidPropertyRegistration[] = [];
  let kept = '';
  let copied = 0;
  for (const { start, end, name } of propertyRules(css)) {
    const checked = checkRegistration(css.slice(start, end));
    kept += css.slice(copied, start);
    if ('rule' in checked) kept += checked.rule;
    else invalid.push({ name, reason: checked.reason });
    copied = end;
  }
  return { css: kept + css.slice(copied), invalid };
}

/** What a kept `@property` rule registers. */
export interface PropertyRegistration {
  syntax: string;
  initialValue: string | undefined;
}

/** The registrations in `css`, by custom-property name. */
export function propertyRegistrations(
  css: string
): Map<string, PropertyRegistration> {
  const registrations = new Map<string, PropertyRegistration>();
  for (const { start, end, name } of propertyRules(css)) {
    registrations.set(name, readRegistration(css.slice(start, end)));
  }
  return registrations;
}

function readRegistration(rule: string): PropertyRegistration {
  return {
    syntax: /syntax:\s*"([^"]*)"/.exec(rule)?.[1]?.trim() ?? '',
    initialValue: /initial-value\s*:\s*([^;}]*)/.exec(rule)?.[1]?.trim(),
  };
}

/** The rule to keep, with an all-absolute math initial value folded, or why
 *  a browser would ignore it. */
function checkRegistration(
  rule: string
): { rule: string } | { reason: string } {
  const { syntax, initialValue } = readRegistration(rule);
  if (initialValue !== undefined && substitutesValue(initialValue)) {
    return {
      reason: `initialValue "${initialValue}" substitutes another value; var(), env() and attr() are not allowed in an initial value`,
    };
  }
  let kept = rule;
  let folded: FoldedInitialValue | undefined;
  if (syntax !== '*') {
    const components = syntax.split('|').map((component) => ({
      text: component.trim(),
      match: SYNTAX_COMPONENT.exec(component.trim()),
    }));
    const unknown = components.find(
      ({ match }) =>
        match === null ||
        (match[1] !== undefined && !SYNTAX_TYPES.has(match[1]))
    );
    if (unknown !== undefined) {
      return {
        reason: `syntax "${syntax}" has the unknown component "${unknown.text}"`,
      };
    }
    if (initialValue === undefined) {
      return { reason: `syntax "${syntax}" needs an initialValue` };
    }
    if (dependsOnContext(initialValue)) {
      return {
        reason: `initialValue "${initialValue}" depends on context; font- and container-relative units are not allowed`,
      };
    }
    folded = foldInitialValue(syntax, initialValue);
    if (folded?.kind === 'invalid') {
      return {
        reason: `initialValue "${initialValue}" is not a valid calculation: ${folded.reason}`,
      };
    }
    if (folded?.kind === 'rejected') {
      return {
        reason: `initialValue "${initialValue}" computes to the ${folded.type} ${folded.text}, which syntax "${syntax}" does not accept`,
      };
    }
    if (folded?.kind === 'folded') {
      kept = rule.replace(INITIAL_VALUE, `$1${folded.text}`);
    }
  }
  try {
    lcssTransform({
      filename: 'animus-registrations.css',
      code: Buffer.from(kept),
    });
    return { rule: kept };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (folded?.kind === 'not-finite') {
      return {
        reason: `initialValue "${initialValue}" computes to an infinite or NaN value, which browsers clamp and which has no plain CSS value to write instead, and the CSS parser that builds the stylesheet cannot read the math (${detail})`,
      };
    }
    if (initialValue !== undefined && MATH_FUNCTION.test(initialValue)) {
      return {
        reason: `the CSS parser that builds the stylesheet cannot read the math in initialValue "${initialValue}" (${detail}); write its computed value instead`,
      };
    }
    return {
      reason: `the CSS parser rejects \`${kept.trim()}\` (${detail})`,
    };
  }
}
