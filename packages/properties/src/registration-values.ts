/**
 * Reads a custom-property registration's initial value as CSS component
 * values: what it substitutes, which units make it depend on context, and
 * what an all-absolute math function computes to. Quoted text and `url()`
 * stay text.
 */

/** One component value, as far as registration checks read it. */
type ComponentValue =
  | { kind: 'function'; name: string; args: ComponentValue[] }
  | { kind: 'numeric'; value: number; unit: string }
  | { kind: 'token'; text: string };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
const IDENT = /^(?:--|-?[a-zA-Z_])[\w-]*/;

/** The component values of `text`; `undefined` when it does not parse. */
function parse(text: string): ComponentValue[] | undefined {
  let at = 0;
  function values(nested: boolean): ComponentValue[] | undefined {
    const out: ComponentValue[] = [];
    while (at < text.length) {
      const char = text[at];
      if (/\s/.test(char)) {
        at += 1;
        continue;
      }
      if (char === ')') {
        at += 1;
        return nested ? out : undefined;
      }
      if (char === '"' || char === "'") {
        const end = stringEnd(text, at);
        if (end === undefined) return undefined;
        out.push({ kind: 'token', text: text.slice(at, end) });
        at = end;
        continue;
      }
      const rest = text.slice(at);
      const ident = IDENT.exec(rest)?.[0];
      if (char === '(' || (ident && rest[ident.length] === '(')) {
        const name = (ident ?? '').toLowerCase();
        at += (ident?.length ?? 0) + 1;
        if (name === 'url') {
          const end = text.indexOf(')', at);
          if (end < 0) return undefined;
          out.push({ kind: 'token', text: 'url()' });
          at = end + 1;
          continue;
        }
        const args = values(true);
        if (args === undefined) return undefined;
        out.push({ kind: 'function', name, args });
        continue;
      }
      const number = NUMBER.exec(rest)?.[0];
      if (number !== undefined) {
        const unit = /^(?:%|[a-zA-Z]+)/.exec(rest.slice(number.length))?.[0];
        out.push({
          kind: 'numeric',
          value: Number(number),
          unit: (unit ?? '').toLowerCase(),
        });
        at += number.length + (unit?.length ?? 0);
        continue;
      }
      out.push({ kind: 'token', text: ident ?? char });
      at += ident?.length ?? 1;
    }
    return nested ? undefined : out;
  }
  return values(false);
}

function stringEnd(text: string, start: number): number | undefined {
  for (let at = start + 1; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1;
    else if (text[at] === text[start]) return at + 1;
  }
  return undefined;
}

function some(
  values: ComponentValue[],
  test: (value: ComponentValue) => boolean
): boolean {
  return values.some(
    (value) =>
      test(value) || (value.kind === 'function' && some(value.args, test))
  );
}

const SUBSTITUTIONS = new Set(['var', 'env', 'attr']);

/** Whether `value` substitutes another value (`var()`, `env()`, `attr()`),
 *  which no registration's initial value may. Unparseable text is read as
 *  substituting when it names one of them. */
export function substitutesValue(value: string): boolean {
  const values = parse(value);
  if (values === undefined) return /\b(?:var|env|attr)\(/i.test(value);
  return some(
    values,
    (component) =>
      component.kind === 'function' && SUBSTITUTIONS.has(component.name)
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
  const values = parse(value);
  if (values === undefined) return false;
  return some(
    values,
    (component) =>
      component.kind === 'numeric' && CONTEXT_UNITS.has(component.unit)
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

/** Evaluates a math function's arguments: `+ - * /` over numbers and
 *  absolute dimensions, nested `calc()`, `min()`, `max()` and `clamp()`. */
function evaluate(values: ComponentValue[]): Computed | undefined {
  let at = 0;
  const operator = (...ops: string[]): string | undefined => {
    const value = values[at];
    if (value?.kind === 'token' && ops.includes(value.text)) {
      at += 1;
      return value.text;
    }
    return undefined;
  };
  function factor(): Computed | undefined {
    const value = values[at];
    at += 1;
    if (value === undefined) return undefined;
    if (value.kind === 'numeric') {
      if (value.unit === '') return { type: 'number', value: value.value };
      const unit = ABSOLUTE_UNITS.get(value.unit);
      return unit && { type: unit[0], value: value.value * unit[1] };
    }
    if (value.kind === 'function') return mathFunction(value);
    return undefined;
  }
  function product(): Computed | undefined {
    let left = factor();
    for (let op = operator('*', '/'); op && left; op = operator('*', '/')) {
      const right = factor();
      if (right === undefined) return undefined;
      if (op === '*') {
        if (left.type !== 'number' && right.type !== 'number') return undefined;
        left = {
          type: left.type === 'number' ? right.type : left.type,
          value: left.value * right.value,
        };
      } else if (right.type === 'number') {
        left = { type: left.type, value: left.value / right.value };
      } else if (right.type === left.type) {
        left = { type: 'number', value: left.value / right.value };
      } else {
        return undefined;
      }
    }
    return left;
  }
  function sum(): Computed | undefined {
    let left = product();
    for (let op = operator('+', '-'); op && left; op = operator('+', '-')) {
      const right = product();
      if (right === undefined || right.type !== left.type) return undefined;
      left = {
        type: left.type,
        value: op === '+' ? left.value + right.value : left.value - right.value,
      };
    }
    return left;
  }
  const result = sum();
  return at === values.length ? result : undefined;
}

function mathFunction(
  value: Extract<ComponentValue, { kind: 'function' }>
): Computed | undefined {
  if (value.name === 'calc' || value.name === '') return evaluate(value.args);
  if (!MATH_FUNCTIONS.has(value.name)) return undefined;
  const args: Computed[] = [];
  let start = 0;
  for (let at = 0; at <= value.args.length; at += 1) {
    const arg = value.args[at];
    if (
      at === value.args.length ||
      (arg?.kind === 'token' && arg.text === ',')
    ) {
      const computed = evaluate(value.args.slice(start, at));
      if (computed === undefined) return undefined;
      args.push(computed);
      start = at + 1;
    }
  }
  const type = args[0]?.type;
  if (type === undefined || args.some((arg) => arg.type !== type)) {
    return undefined;
  }
  const values = args.map((arg) => arg.value);
  if (value.name === 'min') return { type, value: Math.min(...values) };
  if (value.name === 'max') return { type, value: Math.max(...values) };
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

/** A math initial value folded to its computed value. */
export interface FoldedInitialValue {
  /** The computed value as CSS text, such as `1`, `16px` or `90deg`. */
  text: string;
  /** Whether the registration's syntax accepts it. */
  accepted: boolean;
  /** The computed value's data type, for a diagnostic. */
  type: Computed['type'];
}

/**
 * The computed value of an initial value that is one math function (`calc()`,
 * `min()`, `max()`, `clamp()`) over numbers and absolute units, such as
 * `calc(1px / 1px)` → `1`. The browser computes the same value, and CSS
 * tooling that cannot parse the function in that position reads the result.
 * `undefined` for anything else, and for the universal syntax, whose initial
 * value is kept as written.
 */
export function foldInitialValue(
  syntax: string,
  initialValue: string
): FoldedInitialValue | undefined {
  if (syntax.trim() === '*') return undefined;
  const values = parse(initialValue);
  const only = values?.length === 1 ? values[0] : undefined;
  if (only?.kind !== 'function' || !MATH_FUNCTIONS.has(only.name)) {
    return undefined;
  }
  const computed = mathFunction(only);
  if (computed === undefined) return undefined;
  const accepted = syntax.split('|').some((component) => {
    const type = /<([a-z-]+)>/.exec(component)?.[1];
    if (
      type === undefined ||
      ACCEPTING_SYNTAX_TYPES.get(type) !== computed.type
    ) {
      return false;
    }
    return type !== 'integer' || Number.isInteger(computed.value);
  });
  const number = Number(computed.value.toPrecision(12));
  return {
    text: `${number}${CANONICAL_UNITS[computed.type]}`,
    accepted,
    type: computed.type,
  };
}

/** An initial value folded when its syntax accepts the computed value, and
 *  unchanged otherwise: what a registration records and emits. */
export function registeredInitialValue(
  syntax: string,
  initialValue: string
): string {
  const folded = foldInitialValue(syntax, initialValue);
  return folded?.accepted ? folded.text : initialValue;
}
