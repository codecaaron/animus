import {
  dependsOnContext,
  foldInitialValue,
  substitutesValue,
} from '@animus-ui/properties';
import { transform as lcssTransform } from 'lightningcss';

/** A theme `@property` registration that browsers would ignore. */
export interface InvalidPropertyRegistration {
  name: string;
  reason: string;
}

const PROPERTY_RULE = /@property\s+(--[\w-]+)\s*\{[^}]*\}\n?/g;

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
 * value that substitutes another value or depends on context, or one the
 * syntax does not accept. Minifying a stylesheet that contains such a rule
 * can also fail. An all-absolute math initial value is written as its
 * computed value, which the minifier reads.
 */
export function splitInvalidPropertyRegistrations(css: string) {
  const invalid: InvalidPropertyRegistration[] = [];
  const kept = css.replace(PROPERTY_RULE, (rule: string, name: string) => {
    const checked = checkRegistration(rule);
    if ('rule' in checked) return checked.rule;
    invalid.push({ name, reason: checked.reason });
    return '';
  });
  return { css: kept, invalid };
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
  for (const match of css.matchAll(PROPERTY_RULE)) {
    registrations.set(match[1], readRegistration(match[0]));
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
    const folded = foldInitialValue(syntax, initialValue);
    if (folded !== undefined && !folded.accepted) {
      return {
        reason: `initialValue "${initialValue}" computes to the ${folded.type} ${folded.text}, which syntax "${syntax}" does not accept`,
      };
    }
    if (folded !== undefined) {
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
