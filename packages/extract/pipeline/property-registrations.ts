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

/** The syntax types whose values can carry a font- or container-relative
 *  unit, which makes a typed initial value depend on context. */
const DIMENSION_TYPES = new Set([
  'image',
  'length',
  'length-percentage',
  'transform-function',
  'transform-list',
]);

const RELATIVE_UNIT =
  /(?:\d|\.)(?:r?em|r?ex|r?cap|r?ch|r?ic|r?lh|cq(?:w|h|i|b|min|max))\b/i;

const SUBSTITUTION = /\b(?:var|env|attr)\(/i;

/** Quoted strings and `url()` hold text, never units or substitutions. */
const LITERAL_TEXT = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)/gi;

/**
 * Removes the `@property` rules browsers would ignore — an unknown syntax
 * component, a syntax other than `*` without an initial value, an initial
 * value that depends on context, or one the syntax does not accept.
 * Minifying a stylesheet that contains such a rule can also fail.
 */
export function splitInvalidPropertyRegistrations(css: string) {
  const invalid: InvalidPropertyRegistration[] = [];
  const kept = css.replace(PROPERTY_RULE, (rule: string, name: string) => {
    const reason = registrationFailure(rule);
    if (reason === null) return rule;
    invalid.push({ name, reason });
    return '';
  });
  return { css: kept, invalid };
}

function registrationFailure(rule: string): string | null {
  const syntax = /syntax:\s*"([^"]*)"/.exec(rule)?.[1]?.trim() ?? '';
  const initialValue = /initial-value\s*:\s*([^;}]*)/.exec(rule)?.[1]?.trim();
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
      return `syntax "${syntax}" has the unknown component "${unknown.text}"`;
    }
    if (initialValue === undefined) {
      return `syntax "${syntax}" needs an initialValue`;
    }
    const dimensional = components.some(
      ({ match }) => match?.[1] !== undefined && DIMENSION_TYPES.has(match[1])
    );
    const value = initialValue.replace(LITERAL_TEXT, '');
    if (
      SUBSTITUTION.test(value) ||
      (dimensional && RELATIVE_UNIT.test(value))
    ) {
      return `initialValue "${initialValue}" depends on context; font- and container-relative units and var(), env() and attr() are not allowed`;
    }
  }
  try {
    lcssTransform({
      filename: 'animus-registrations.css',
      code: Buffer.from(rule),
    });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `the CSS parser rejects \`${rule.trim()}\` (${detail})`;
  }
}
