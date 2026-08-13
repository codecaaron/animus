/**
 * The text grammar of a probe request: scenario points, assertions and world
 * deltas as flags.
 *
 * Every parser here fails loudly with the alternatives spelled out. A CLI for
 * agents is a machine surface, and a malformed request that silently degrades
 * into a weaker question (an unbound point, a dropped assertion) would produce
 * an answer to a question nobody asked — the one failure mode DESIGN §8 exists
 * to prevent.
 */

import { asRuleId } from '../core/identity';

import type { DimensionValue, ScenarioPoint } from '../core/scenario';
import type { WorldDelta } from '../core/world';
import type { OracleAssertion } from '../engines/prove';

/** A malformed invocation — mapped to exit 2 by `runCli`. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/**
 * Scenario values are typed (`state:X:disabled` is boolean, `viewport.inline`
 * is numeric), and the shell only ever hands over strings. Coercion is
 * deliberately literal — `true`, `false` and a plain number — so a variant
 * option spelled `true` stays reachable as a string nowhere and no option name
 * is silently retyped.
 */
export const coerce = (raw: string): DimensionValue => {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (NUMERIC.test(text)) return Number(text);
  return text;
};

const splitFirst = (
  raw: string,
  separator: string
): readonly [string, string] | undefined => {
  const index = raw.indexOf(separator);
  if (index === -1) return undefined;
  return [raw.slice(0, index), raw.slice(index + separator.length)];
};

const splitLast = (
  raw: string,
  separator: string
): readonly [string, string] | undefined => {
  const index = raw.lastIndexOf(separator);
  if (index === -1) return undefined;
  return [raw.slice(0, index), raw.slice(index + separator.length)];
};

export const parsePoint = (
  spec: string,
  named: Readonly<Record<string, ScenarioPoint>>
): ScenarioPoint => {
  if (!spec.includes('=')) {
    const found = named[spec];
    if (found !== undefined) return found;
    const names = Object.keys(named).sort();
    throw new UsageError(
      `--at '${spec}': unknown named scenario — available: ${
        names.length === 0 ? '(none declared)' : names.join(', ')
      }. A point can also be given as comma-separated bindings, e.g. ` +
        "'viewport.inline=390,mode=dark'"
    );
  }

  const point: Record<string, DimensionValue> = {};
  for (const binding of spec.split(',')) {
    const trimmed = binding.trim();
    if (trimmed.length === 0) continue;
    const parts = splitFirst(trimmed, '=');
    if (parts === undefined) {
      throw new UsageError(
        `--at '${spec}': binding '${trimmed}' has no '=' — write ` +
          '<dimension>=<value>'
      );
    }
    point[parts[0].trim()] = coerce(parts[1]);
  }
  return point;
};

const ASSERTION_KINDS = [
  'effective-value:<property>=<value>',
  'effective-value-in:<property>=<v1>|<v2>[|...]',
  'winner-origin-token:<property>=<--token>',
  'mode-invariant:<property>',
  'no-important',
];

const assertionParts = (
  spec: string,
  kind: string,
  rest: string
): readonly [string, string] => {
  const parts = splitFirst(rest, '=');
  if (parts === undefined || parts[0].length === 0) {
    throw new UsageError(
      `--assert '${spec}': ${kind} needs <property>=<value> after the kind`
    );
  }
  return [parts[0], parts[1]];
};

export const parseAssertion = (
  spec: string,
  target: string
): OracleAssertion => {
  const head = splitFirst(spec, ':');
  const kind = head === undefined ? spec : head[0];
  const rest = head === undefined ? '' : head[1];

  switch (kind) {
    case 'no-important':
      if (rest.length > 0) {
        throw new UsageError(
          `--assert '${spec}': no-important takes no argument`
        );
      }
      return { kind, target };
    case 'mode-invariant':
      if (rest.length === 0 || rest.includes('=')) {
        throw new UsageError(
          `--assert '${spec}': mode-invariant takes a bare property, e.g. ` +
            "'mode-invariant:padding'"
        );
      }
      return { kind, target, property: rest };
    case 'effective-value': {
      const [property, expected] = assertionParts(spec, kind, rest);
      return { kind, target, property, expected };
    }
    case 'effective-value-in': {
      const [property, allowed] = assertionParts(spec, kind, rest);
      const values = allowed.split('|').filter((value) => value.length > 0);
      if (values.length === 0) {
        throw new UsageError(
          `--assert '${spec}': effective-value-in needs at least one ` +
            "allowed value, e.g. 'effective-value-in:padding=1rem|1.5rem'"
        );
      }
      return { kind, target, property, allowed: values };
    }
    case 'winner-origin-token': {
      const [property, token] = assertionParts(spec, kind, rest);
      if (!token.startsWith('--')) {
        throw new UsageError(
          `--assert '${spec}': winner-origin-token needs a custom property ` +
            "name, e.g. 'winner-origin-token:color=--color-danger'"
        );
      }
      return { kind, target, property, token };
    }
    default:
      throw new UsageError(
        `--assert '${spec}': unknown assertion kind '${kind}' — supported: ` +
          ASSERTION_KINDS.join(', ')
      );
  }
};

/** `--force <dimension>=<value>` */
export const parseForce = (spec: string): WorldDelta => {
  const parts = splitFirst(spec, '=');
  if (parts === undefined || parts[0].length === 0) {
    throw new UsageError(
      `--force '${spec}': write <dimension>=<value>, e.g. 'mode=dark'`
    );
  }
  return {
    kind: 'force-dimension',
    dimension: parts[0].trim(),
    value: coerce(parts[1]),
  };
};

/**
 * `--replace-token=<--var>=<value>`.
 *
 * The bare name (`color-danger=#000`) is accepted too, because `parseArgs`
 * refuses a dash-leading value in the space-separated form — a token is always
 * a custom property, so prefixing an unprefixed name invents nothing. A single
 * leading dash is still an error rather than a guess about which spelling was
 * meant.
 */
export const parseTokenReplacement = (spec: string): WorldDelta => {
  const parts = splitFirst(spec, '=');
  const name = parts === undefined ? '' : parts[0].trim();
  const token = name.startsWith('--')
    ? name
    : /^[A-Za-z]/.test(name)
      ? `--${name}`
      : undefined;

  if (parts === undefined || token === undefined) {
    throw new UsageError(
      `--replace-token '${spec}': write <--token>=<value>, e.g. ` +
        "'--replace-token=--color-danger=#000' (the '=' form is required " +
        "when the value starts with a dash) or '--replace-token " +
        "color-danger=#000'"
    );
  }
  return { kind: 'replace-token', token, value: parts[1] };
};

/** `--remove-rule <ruleId>:<property>` — the exact, target-free form. */
export const parseRuleRemoval = (spec: string): WorldDelta => {
  const parts = splitLast(spec, ':');
  if (parts === undefined || parts[0].length === 0 || parts[1].length === 0) {
    throw new UsageError(
      `--remove-rule '${spec}': write <ruleId>:<property>, e.g. ` +
        "'a5e7b19f52a9de29:color' (rule ids come from --json output)"
    );
  }
  return {
    kind: 'remove-declaration',
    rule: asRuleId(parts[0]),
    property: parts[1],
  };
};

export interface PropertyReplacement {
  property: string;
  value: string;
}

/** `--replace <property>=<value>` — the rule is resolved by the caller. */
export const parsePropertyReplacement = (spec: string): PropertyReplacement => {
  const parts = splitFirst(spec, '=');
  if (parts === undefined || parts[0].length === 0) {
    throw new UsageError(
      `--replace '${spec}': write <property>=<value>, e.g. 'color=#000'`
    );
  }
  return { property: parts[0].trim(), value: parts[1] };
};

export const parsePositiveInteger = (raw: string, flag: string): number => {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(
      `${flag} '${raw}': expected a positive integer cell budget`
    );
  }
  return parsed;
};
