import type { DeclarationProp, SystemProp } from './types/config';

/** One key's declarations: canonical member name → CSS value. */
export interface DeclarationRecord {
  [member: string]: string | number;
}

/** Scale key → that key's complete record. */
export interface DeclarationScaleValues {
  [key: string]: DeclarationRecord;
}

/**
 * What an author can hand a declaration scale before it is validated: plain
 * JavaScript data whose shape the types may not have enforced.
 */
export type AuthoredDeclarationValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | AuthoredDeclarationRecord
  | readonly AuthoredDeclarationValue[];

export interface AuthoredDeclarationRecord {
  readonly [key: string]: AuthoredDeclarationValue;
}

/**
 * Fields of a value prop. A declaration prop carrying one would imply a
 * primary property, a transform or a negative form it does not have.
 */
const VALUE_PROP_FIELDS = [
  'property',
  'properties',
  'transform',
  'negative',
  'strict',
  'variable',
  'currentVar',
] as const satisfies readonly (keyof DeclarationProp)[];

const MEMBER_NAME = /^-?[A-Za-z][A-Za-z0-9-]*$/;

/** Representation tags, which tell data apart without trusting its type. */
function tagOf(value: AuthoredDeclarationValue): string {
  return Object.prototype.toString.call(value);
}

function isRecord(
  value: AuthoredDeclarationValue
): value is AuthoredDeclarationRecord {
  return tagOf(value) === '[object Object]';
}

function isText(value: AuthoredDeclarationValue): value is string {
  return tagOf(value) === '[object String]';
}

function isFiniteNumber(value: AuthoredDeclarationValue): value is number {
  return tagOf(value) === '[object Number]' && Number.isFinite(value);
}

export function isDeclarationProp(
  entry: SystemProp | undefined
): entry is DeclarationProp {
  return entry?.kind === 'declarations';
}

/**
 * The camelCase spelling of a CSS property, so `font-size` and `fontSize`
 * name one member; vendor prefixes follow React's spelling (`WebkitX`,
 * `msX`). Custom properties are not members.
 */
export function canonicalMemberName(name: string): string | undefined {
  if (!MEMBER_NAME.test(name) || name.endsWith('-') || name.includes('--')) {
    return undefined;
  }
  if (!name.includes('-')) return name;
  const vendor = name.startsWith('-') ? name.slice(1) : undefined;
  const words = (vendor ?? name).split('-');
  const head =
    vendor === undefined || words[0] === 'ms'
      ? words[0]
      : words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return (
    head +
    words
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
  );
}

/** Canonical members in authored order; a duplicate spelling throws. */
function canonicalMembers(
  label: string,
  members: readonly AuthoredDeclarationValue[]
): string[] {
  const seen = new Set<string>();
  return members.map((member) => {
    const canonical = isText(member) ? canonicalMemberName(member) : undefined;
    if (canonical === undefined) {
      throw new Error(
        `${label}: member ${JSON.stringify(member)} is not a CSS property name.`
      );
    }
    if (seen.has(canonical)) {
      throw new Error(
        `${label}: member '${canonical}' is listed more than once.`
      );
    }
    seen.add(canonical);
    return canonical;
  });
}

/**
 * A declaration prop with its members canonicalized. Matching its members
 * against the effective scale happens where the system and theme meet.
 */
export function validateDeclarationProp(
  propName: string,
  entry: DeclarationProp
): DeclarationProp {
  const label = `Declaration prop "${propName}"`;
  for (const field of VALUE_PROP_FIELDS) {
    if (entry[field] !== undefined) {
      throw new Error(
        `${label}: '${field}' does not apply to a declaration prop — its scale's records name every property it sets.`
      );
    }
  }
  if (!isText(entry.scale) || entry.scale === '') {
    throw new Error(
      `${label}: 'scale' must name a scale registered with addDeclarationScale.`
    );
  }
  if (!Array.isArray(entry.members) || entry.members.length === 0) {
    throw new Error(`${label}: 'members' must list at least one property.`);
  }
  return {
    kind: 'declarations',
    scale: entry.scale,
    // SAFETY: each member passed `canonicalMemberName`, which keeps the
    // camelCase spelling the property types use.
    members: canonicalMembers(
      label,
      entry.members
    ) as DeclarationProp['members'],
  };
}

function memberSetKey(record: DeclarationRecord): string {
  return Object.keys(record).sort().join(',');
}

function describeLeaf(value: AuthoredDeclarationValue): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (isRecord(value)) return 'a nested record';
  if (tagOf(value) === '[object Number]') return String(value);
  return tagOf(value).slice(8, -1).toLowerCase();
}

function validateRecord(
  where: string,
  record: AuthoredDeclarationValue
): DeclarationRecord {
  if (!isRecord(record) || Object.keys(record).length === 0) {
    throw new Error(`${where} must be a non-empty record of declarations.`);
  }
  const canonical: DeclarationRecord = {};
  for (const [member, value] of Object.entries(record)) {
    const name = canonicalMemberName(member);
    if (name === undefined) {
      throw new Error(
        `${where}: member '${member}' is not a CSS property name.`
      );
    }
    if (name in canonical) {
      throw new Error(`${where}: member '${name}' is set more than once.`);
    }
    if (!isText(value) && !isFiniteNumber(value)) {
      throw new Error(
        `${where}: member '${name}' must be a string or finite number, got ${describeLeaf(value)}.`
      );
    }
    canonical[name] = value;
  }
  return canonical;
}

/**
 * Each record must be flat, with string or finite-number values, and every
 * record of one scale must set the same members. Returns the records with
 * canonical member names.
 */
export function validateDeclarationRecords(
  label: string,
  scale: string,
  values: AuthoredDeclarationValue
): DeclarationScaleValues {
  if (!isRecord(values) || Object.keys(values).length === 0) {
    throw new Error(
      `${label}: declaration scale '${scale}' must map at least one key to a record.`
    );
  }
  const result: DeclarationScaleValues = {};
  for (const [key, record] of Object.entries(values)) {
    result[key] = validateRecord(
      `${label}: declaration scale '${scale}' key '${key}'`,
      record
    );
  }
  assertUniformMembers(label, scale, result);
  return result;
}

/** Every record names the members of the first; the diagnostic names the gap. */
export function assertUniformMembers(
  label: string,
  scale: string,
  values: DeclarationScaleValues
): void {
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return;
  const expected = values[keys[0]];
  const expectedKey = memberSetKey(expected);
  for (const key of keys.slice(1)) {
    const record = values[key];
    if (memberSetKey(record) === expectedKey) continue;
    const missing = Object.keys(expected).filter(
      (member) => !(member in record)
    );
    const extra = Object.keys(record).filter((member) => !(member in expected));
    const gaps = [
      missing.length > 0
        ? `is missing ${missing.map((member) => `'${member}'`).join(', ')}`
        : '',
      extra.length > 0
        ? `sets extra ${extra.map((member) => `'${member}'`).join(', ')}`
        : '',
    ].filter(Boolean);
    throw new Error(
      `${label}: declaration scale '${scale}' key '${key}' ${gaps.join(' and ')} relative to key '${keys[0]}' — every record must set the same members.`
    );
  }
}
