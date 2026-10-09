/**
 * Reads a custom-property registration's initial value as CSS component
 * values: what it substitutes, which units make it depend on context, and
 * what an all-absolute math function computes to. Tokens come from the shared
 * CSS reader, so comments are trivia, quoted strings and `url()` stay text,
 * and escaped names are decoded.
 */

import { componentValues, isSpace, someValue, tokenize } from './css-tokens.js';

import type { ComponentValue } from './css-tokens.js';

type Block = Extract<ComponentValue, { kind: 'block' }>;

const asciiLower = (text: string) =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const parse = (text: string) => componentValues(tokenize(text));

/** A function's ASCII-lowercase name, `''` for a parenthesized block, and
 *  `undefined` for anything else. */
function functionName(value: ComponentValue | undefined): string | undefined {
  if (value?.kind !== 'block') return undefined;
  if (value.open.type === 'function') return asciiLower(value.open.value);
  return value.open.type === '(' ? '' : undefined;
}

const SUBSTITUTIONS = new Set(['var', 'env', 'attr']);

/** Whether `value` substitutes another value (`var()`, `env()`, `attr()`),
 *  which no registration's initial value may. */
export function substitutesValue(value: string): boolean {
  return someValue(parse(value), (component) =>
    SUBSTITUTIONS.has(functionName(component) ?? '')
  );
}

const CONTEXT_UNITS = new Set([
  'em',
  'rem',
  'ex',
  'rex',
  'cap',
  'rcap',
  'ch',
  'rch',
  'ic',
  'ric',
  'lh',
  'rlh',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
]);

/** Whether `value` uses a font- or container-relative unit, inside math
 *  functions too, which makes a typed initial value depend on context. */
export function dependsOnContext(value: string): boolean {
  return someValue(
    parse(value),
    (component) =>
      component.kind === 'token' &&
      component.token.type === 'dimension' &&
      CONTEXT_UNITS.has(asciiLower(component.token.value))
  );
}

/** What an all-absolute math expression computes to. */
interface Computed {
  type: 'number' | 'length' | 'angle' | 'time' | 'resolution';
  value: number;
}

/** Absolute units, by the canonical unit each converts to. */
const ABSOLUTE_UNITS = new Map<string, [Computed['type'], number]>([
  ['px', ['length', 1]],
  ['cm', ['length', 96 / 2.54]],
  ['mm', ['length', 96 / 25.4]],
  ['q', ['length', 96 / 101.6]],
  ['in', ['length', 96]],
  ['pt', ['length', 4 / 3]],
  ['pc', ['length', 16]],
  ['deg', ['angle', 1]],
  ['grad', ['angle', 0.9]],
  ['rad', ['angle', 180 / Math.PI]],
  ['turn', ['angle', 360]],
  ['s', ['time', 1]],
  ['ms', ['time', 0.001]],
  ['dppx', ['resolution', 1]],
  ['x', ['resolution', 1]],
  ['dpi', ['resolution', 1 / 96]],
  ['dpcm', ['resolution', 2.54 / 96]],
]);

const CANONICAL_UNITS = {
  number: '',
  length: 'px',
  angle: 'deg',
  time: 's',
  resolution: 'dppx',
} satisfies Record<Computed['type'], string>;

const MATH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp']);

/** A math expression that breaks CSS calculation syntax, and why. */
interface Invalid {
  invalid: string;
}

type Evaluated = Computed | Invalid | undefined;

/** A calculation's tree: `+ - * /` over component values. */
type Calculation =
  | { op: string; left: Calculation; right: Calculation }
  | { value: ComponentValue };

const operatorOf = (value: ComponentValue | undefined) =>
  value?.kind === 'token' &&
  value.token.type === 'delim' &&
  '+-*/'.includes(value.token.value)
    ? value.token.value
    : undefined;

/**
 * A math function's argument read as CSS calculation syntax, or what is out
 * of place: `+` and `-` need whitespace on both sides, every operator needs a
 * value on each side, and two values need an operator between them.
 */
function readCalculation(values: ComponentValue[]): Calculation | Invalid {
  let start = 0;
  let end = values.length;
  while (start < end && isSpace(values[start])) start += 1;
  while (end > start && isSpace(values[end - 1])) end -= 1;
  if (start === end) return { invalid: 'a calculation needs a value' };
  let at = start;
  const skipSpace = () => {
    while (at < end && isSpace(values[at])) at += 1;
  };
  const operand = (): Calculation | Invalid => {
    skipSpace();
    const value = values[at];
    if (at >= end || operatorOf(value) !== undefined) {
      return { invalid: 'an operator needs a value on each side' };
    }
    at += 1;
    return { value };
  };
  const product = (): Calculation | Invalid => {
    let left = operand();
    while (!('invalid' in left)) {
      const before = at;
      skipSpace();
      const op = operatorOf(values[at]);
      if (op !== '*' && op !== '/') {
        at = before;
        return left;
      }
      at += 1;
      const right = operand();
      if ('invalid' in right) return right;
      left = { op, left, right };
    }
    return left;
  };
  let sum = product();
  while (!('invalid' in sum) && at < end) {
    const spaced = isSpace(values[at]);
    skipSpace();
    const op = operatorOf(values[at]);
    if (op !== '+' && op !== '-') {
      return { invalid: 'two values need an operator between them' };
    }
    if (at + 1 >= end) {
      return { invalid: 'an operator needs a value on each side' };
    }
    if (!spaced || !isSpace(values[at + 1])) {
      return { invalid: '"+" and "-" need whitespace on both sides' };
    }
    at += 1;
    const right = product();
    if ('invalid' in right) return right;
    sum = { op, left: sum, right };
  }
  return sum;
}

/** Both sides evaluated, so a broken expression on either side is reported
 *  even where the other cannot be evaluated. */
function combine(op: string, left: Evaluated, right: Evaluated): Evaluated {
  if (left !== undefined && 'invalid' in left) return left;
  if (right !== undefined && 'invalid' in right) return right;
  if (left === undefined || right === undefined) return undefined;
  if (op === '+' || op === '-') {
    if (left.type !== right.type) return undefined;
    return {
      type: left.type,
      value: op === '+' ? left.value + right.value : left.value - right.value,
    };
  }
  if (op === '*') {
    if (left.type !== 'number' && right.type !== 'number') return undefined;
    return {
      type: left.type === 'number' ? right.type : left.type,
      value: left.value * right.value,
    };
  }
  if (right.type === 'number') {
    return { type: left.type, value: left.value / right.value };
  }
  return right.type === left.type
    ? { type: 'number', value: left.value / right.value }
    : undefined;
}

/** The calculation constants, by their ASCII-lowercase name. */
const CONSTANTS = new Map([
  ['e', Math.E],
  ['pi', Math.PI],
  ['infinity', Infinity],
  ['-infinity', -Infinity],
  ['nan', NaN],
]);

function evaluate(node: Calculation): Evaluated {
  if ('op' in node) {
    return combine(node.op, evaluate(node.left), evaluate(node.right));
  }
  const { value } = node;
  if (value.kind === 'block') return mathFunction(value);
  const { token } = value;
  if (token.type === 'number') return { type: 'number', value: token.number };
  if (token.type === 'dimension') {
    const unit = ABSOLUTE_UNITS.get(asciiLower(token.value));
    return unit && { type: unit[0], value: token.number * unit[1] };
  }
  const constant =
    token.type === 'ident' ? CONSTANTS.get(asciiLower(token.value)) : undefined;
  return constant === undefined
    ? undefined
    : { type: 'number', value: constant };
}

/** `calc()`, `min()`, `max()` and `clamp()` over numbers and absolute
 *  dimensions, nested ones and parenthesized blocks included. */
function mathFunction(value: Block): Evaluated {
  const name = functionName(value);
  if (name === undefined || (name !== '' && !MATH_FUNCTIONS.has(name))) {
    return undefined;
  }
  const parts: ComponentValue[][] = [[]];
  for (const arg of value.children) {
    if (arg.kind === 'token' && arg.token.type === ',') parts.push([]);
    else parts[parts.length - 1].push(arg);
  }
  if ((name === '' || name === 'calc') && parts.length > 1) {
    return {
      invalid: 'commas separate only the arguments of min(), max() and clamp()',
    };
  }
  const args: Computed[] = [];
  let unsupported = false;
  for (const part of parts) {
    const calculation = readCalculation(part);
    if ('invalid' in calculation) return calculation;
    const computed = evaluate(calculation);
    if (computed !== undefined && 'invalid' in computed) return computed;
    if (computed === undefined) unsupported = true;
    else args.push(computed);
  }
  if (unsupported) return undefined;
  if (name === '' || name === 'calc') return args[0];
  const type = args[0].type;
  if (args.some((arg) => arg.type !== type)) return undefined;
  const values = args.map((arg) => arg.value);
  if (name === 'min') return { type, value: Math.min(...values) };
  if (name === 'max') return { type, value: Math.max(...values) };
  if (values.length !== 3) return undefined;
  const [low, middle, high] = values;
  return { type, value: Math.max(low, Math.min(middle, high)) };
}

/** The data type each folded value is written as, by syntax type. */
const ACCEPTING_SYNTAX_TYPES = new Map<string, Computed['type']>([
  ['number', 'number'],
  ['integer', 'number'],
  ['length', 'length'],
  ['length-percentage', 'length'],
  ['angle', 'angle'],
  ['time', 'time'],
  ['resolution', 'resolution'],
]);

/** What a math initial value folds to. */
export type FoldedInitialValue =
  /** The computed value the syntax accepts, as CSS text such as `1`, `16px`
   *  or `90deg`. */
  | { kind: 'folded'; text: string }
  /** A computed value no syntax alternative accepts. */
  | { kind: 'rejected'; text: string; type: Computed['type'] }
  /** Math that breaks CSS calculation syntax, which browsers ignore. */
  | { kind: 'invalid'; reason: string }
  /** An infinite or NaN result: browsers clamp it, and it has no plain
   *  value to write. */
  | { kind: 'not-finite' };

/**
 * The computed value of an initial value that is one math function (`calc()`,
 * `min()`, `max()`, `clamp()`) over numbers and absolute units, such as
 * `calc(1px / 1px)` → `1`. The browser computes the same value, and CSS
 * tooling that cannot parse the function in that position reads the result.
 * The syntax's alternatives are tried in their declared order, and an
 * `<integer>` one rounds a number result to the nearest integer, halves
 * toward positive infinity, as CSS does. `undefined` for anything else, and
 * for the universal syntax, whose initial value is kept as written.
 */
export function foldInitialValue(
  syntax: string,
  initialValue: string
): FoldedInitialValue | undefined {
  if (syntax.trim() === '*') return undefined;
  const values = parse(initialValue).filter((value) => !isSpace(value));
  const only = values.length === 1 ? values[0] : undefined;
  if (only?.kind !== 'block' || !MATH_FUNCTIONS.has(functionName(only) ?? '')) {
    return undefined;
  }
  const computed = mathFunction(only);
  if (computed === undefined) return undefined;
  if ('invalid' in computed)
    return { kind: 'invalid', reason: computed.invalid };
  if (!Number.isFinite(computed.value)) return { kind: 'not-finite' };
  for (const component of syntax.split('|')) {
    const type = /<([a-z-]+)>/.exec(component)?.[1];
    if (
      type === undefined ||
      ACCEPTING_SYNTAX_TYPES.get(type) !== computed.type
    ) {
      continue;
    }
    return {
      kind: 'folded',
      // Digits only: an integer written with an exponent reads as a number.
      text:
        type === 'integer'
          ? BigInt(Math.round(computed.value)).toString()
          : written(computed),
    };
  }
  return { kind: 'rejected', text: written(computed), type: computed.type };
}

function written(computed: Computed): string {
  const number = Number(computed.value.toPrecision(12));
  return `${number}${CANONICAL_UNITS[computed.type]}`;
}
