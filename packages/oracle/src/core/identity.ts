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
export type WorldId = string & { readonly __brand: 'WorldId' };
export type FactId = string & { readonly __brand: 'FactId' };
export type RuleId = string & { readonly __brand: 'RuleId' };
export type TargetId = string & { readonly __brand: 'TargetId' };
export type ObligationId = string & { readonly __brand: 'ObligationId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type ProbeStateId = string & { readonly __brand: 'ProbeStateId' };
export type DependencyId = string & { readonly __brand: 'DependencyId' };

export const asWorldId = (s: string): WorldId => s as WorldId;
export const asFactId = (s: string): FactId => s as FactId;
export const asRuleId = (s: string): RuleId => s as RuleId;
export const asTargetId = (s: string): TargetId => s as TargetId;
export const asObligationId = (s: string): ObligationId => s as ObligationId;
export const asEvidenceId = (s: string): EvidenceId => s as EvidenceId;
export const asProbeStateId = (s: string): ProbeStateId => s as ProbeStateId;
export const asDependencyId = (s: string): DependencyId => s as DependencyId;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
};

const encodeString = (value: string): string => JSON.stringify(value);

const encode = (value: unknown, path: string): string => {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return encodeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
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
    case 'undefined':
      throw new TypeError(
        `canonicalJson: undefined at ${path} — undefined is representable ` +
          'only as an omitted object property, never as a root value or an ' +
          'array element'
      );
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(
        `canonicalJson: unsupported ${typeof value} at ${path} — the ` +
          'canonical form admits no lossy encoding for it'
      );
    default:
      break;
  }

  const object = value as object;

  if (Array.isArray(object)) {
    const items = object.map((item, index) =>
      encode(item, `${path}[${index}]`)
    );
    return `[${items.join(',')}]`;
  }

  if (!isPlainObject(object)) {
    throw new TypeError(
      `canonicalJson: non-plain object at ${path} (${
        (Object.getPrototypeOf(object) as { constructor?: { name?: string } })
          ?.constructor?.name ?? 'unknown prototype'
      }) — class instances, Map/Set/Date and friends have no declared ` +
        'canonical form; convert to a plain record first'
    );
  }

  const record = object as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const entries = keys.map(
    (key) => `${encodeString(key)}:${encode(record[key], `${path}.${key}`)}`
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
export const canonicalJson = (value: unknown): string => encode(value, '$');

/**
 * Content address: the first 16 hex chars (64 bits) of sha256 over
 * `canonicalJson`. Ids are compared, never inverted, and 64 bits keeps
 * collisions out of reach for corpora many orders of magnitude larger than a
 * design system while staying short enough to read in a terminal.
 */
export const stableHash = (value: unknown): string =>
  createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex')
    .slice(0, 16);
