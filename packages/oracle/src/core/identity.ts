import { createHash } from 'node:crypto';

/**
 * Branded identity strings.
 *
 * Every id in the oracle is content-addressed (see `stableHash`), so the brand
 * is the only thing separating a `FactId` from an `EvidenceId` at the type
 * level: two structurally different subjects can never share an id, but two
 * ids of different kinds are indistinguishable at runtime. The brands make the
 * substrate's plumbing (ledgers, graphs, probe state) type-checked without
 * paying for wrapper objects, which would break canonical hashing.
 */
type IdentityBrand =
  | 'WorldId'
  | 'FactId'
  | 'RuleId'
  | 'TargetId'
  | 'ObligationId'
  | 'EvidenceId'
  | 'ProbeStateId'
  | 'DependencyId';

type BrandedId<Brand extends IdentityBrand> = string & {
  readonly __brand: Brand;
};

export type WorldId = BrandedId<'WorldId'>;
export type FactId = BrandedId<'FactId'>;
export type RuleId = BrandedId<'RuleId'>;
export type TargetId = BrandedId<'TargetId'>;
export type ObligationId = BrandedId<'ObligationId'>;
export type EvidenceId = BrandedId<'EvidenceId'>;
export type ProbeStateId = BrandedId<'ProbeStateId'>;
export type DependencyId = BrandedId<'DependencyId'>;

const brandId = <Brand extends IdentityBrand>(
  value: string
): BrandedId<Brand> => {
  // SAFETY: An identity brand is a compile-time-only intersection. Returning
  // the same string preserves its runtime value and equality semantics.
  return value as BrandedId<Brand>;
};

export const asWorldId = (value: string): WorldId => brandId<'WorldId'>(value);
export const asFactId = (value: string): FactId => brandId<'FactId'>(value);
export const asRuleId = (value: string): RuleId => brandId<'RuleId'>(value);
export const asTargetId = (value: string): TargetId =>
  brandId<'TargetId'>(value);
export const asObligationId = (value: string): ObligationId =>
  brandId<'ObligationId'>(value);
export const asEvidenceId = (value: string): EvidenceId =>
  brandId<'EvidenceId'>(value);
export const asProbeStateId = (value: string): ProbeStateId =>
  brandId<'ProbeStateId'>(value);
export const asDependencyId = (value: string): DependencyId =>
  brandId<'DependencyId'>(value);

interface CanonicalConstructor extends CanonicalReference {
  readonly name?: string;
}

interface CanonicalReference {
  readonly constructor?: CanonicalConstructor;
}

declare const canonicalCallableMarker: unique symbol;

interface CanonicalCallable extends CanonicalReference {
  readonly [canonicalCallableMarker]?: never;
}

type CanonicalValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | symbol
  | CanonicalReference;

interface CanonicalObject extends CanonicalReference {
  readonly [key: string]: CanonicalValue;
}

const isCanonicalReference = <Value>(
  value: Value
): value is Value & CanonicalReference => Object(value) === value;

type ReadPrimitive = () => CanonicalValue;

const acceptsIntrinsicPrimitive = <Value>(
  value: Value,
  read: ReadPrimitive
): boolean => {
  if (isCanonicalReference(value)) return false;

  try {
    read();
    return true;
  } catch {
    return false;
  }
};

const isCanonicalString = <Value>(value: Value): value is Value & string =>
  acceptsIntrinsicPrimitive(value, () => String.prototype.valueOf.call(value));

const isCanonicalBoolean = <Value>(value: Value): value is Value & boolean =>
  acceptsIntrinsicPrimitive(value, () => Boolean.prototype.valueOf.call(value));

const isCanonicalNumber = <Value>(value: Value): value is Value & number =>
  acceptsIntrinsicPrimitive(value, () => Number.prototype.valueOf.call(value));

const isCanonicalBigInt = <Value>(value: Value): value is Value & bigint =>
  acceptsIntrinsicPrimitive(value, () => BigInt.prototype.valueOf.call(value));

const isCanonicalSymbol = <Value>(value: Value): value is Value & symbol =>
  acceptsIntrinsicPrimitive(value, () => Symbol.prototype.valueOf.call(value));

const isCanonicalCallable = <Value>(
  value: Value
): value is Value & CanonicalCallable => {
  if (!isCanonicalReference(value)) return false;

  try {
    Function.prototype.toString.call(value);
    return true;
  } catch {
    return false;
  }
};

const isCanonicalArray = <Value>(
  value: Value
): value is Value & readonly CanonicalValue[] => Array.isArray(value);

const isPlainObject = <Value>(
  value: Value & CanonicalReference
): value is Value & CanonicalObject => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const prototypeName = (value: CanonicalReference): string => {
  const prototype: CanonicalReference | null = Object.getPrototypeOf(value);
  return prototype?.constructor?.name ?? 'unknown prototype';
};

const encodeString = (value: string): string => JSON.stringify(value);

const encode = <Value>(value: Value, path: string): string => {
  if (value === null) return 'null';

  if (isCanonicalString(value)) return encodeString(value);
  if (isCanonicalBoolean(value)) return value ? 'true' : 'false';
  if (isCanonicalNumber(value)) {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonicalJson: non-finite number at ${path} (${String(value)}) ` +
          'has no canonical form — model it as an explicit abstract value ' +
          'or an obligation instead of approximating it'
      );
    }
    // JSON.stringify is exact and round-trippable for finite doubles, and
    // normalises -0 to 0 — two numerically equal values must hash equal.
    return JSON.stringify(value);
  }
  if (value === undefined) {
    throw new TypeError(
      `canonicalJson: undefined at ${path} — undefined is representable ` +
        'only as an omitted object property, never as a root value or an ' +
        'array element'
    );
  }
  if (isCanonicalBigInt(value)) {
    throw new TypeError(
      `canonicalJson: unsupported bigint at ${path} — the canonical form ` +
        'admits no lossy encoding for it'
    );
  }
  if (isCanonicalSymbol(value)) {
    throw new TypeError(
      `canonicalJson: unsupported symbol at ${path} — the canonical form ` +
        'admits no lossy encoding for it'
    );
  }
  if (isCanonicalCallable(value)) {
    throw new TypeError(
      `canonicalJson: unsupported function at ${path} — the canonical form ` +
        'admits no lossy encoding for it'
    );
  }

  if (isCanonicalArray(value)) {
    const items = value.map((item, index) => encode(item, `${path}[${index}]`));
    return `[${items.join(',')}]`;
  }

  if (!isCanonicalReference(value)) {
    throw new TypeError(`canonicalJson: unsupported value at ${path}`);
  }

  if (!isPlainObject(value)) {
    throw new TypeError(
      `canonicalJson: non-plain object at ${path} (${prototypeName(value)}) ` +
        '— class instances, Map/Set/Date and friends have no declared ' +
        'canonical form; convert to a plain record first'
    );
  }

  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const entries = keys.map(
    (key) => `${encodeString(key)}:${encode(value[key], `${path}.${key}`)}`
  );
  return `{${entries.join(',')}}`;
};

/**
 * Deterministic serialisation: object keys sorted, arrays in order, `undefined`
 * properties omitted.
 *
 * Everything the oracle hashes flows through here, so the encoding refuses any
 * value it cannot represent exactly (NaN/Infinity, bigint, functions, symbols,
 * non-plain objects) with a loud `TypeError`. DESIGN §8 forbids silent
 * approximation: a value that cannot be canonically encoded must become an
 * explicit obligation upstream, never a hash of a lossy stand-in — otherwise
 * two different worlds could share an id and the caches would lie.
 */
export const canonicalJson = <Value>(value: Value): string =>
  encode(value, '$');

/**
 * Content address: the first 16 hex chars (64 bits) of sha256 over
 * `canonicalJson`. Ids are compared, never inverted, and 64 bits keeps
 * collisions out of reach for corpora many orders of magnitude larger than a
 * design system while staying short enough to read in a terminal.
 */
export const stableHash = <Value>(value: Value): string =>
  createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex')
    .slice(0, 16);
