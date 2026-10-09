import type { ContextualVarRegistration, ThemeManifest } from '../types/theme';

/** Where a record was first declared. Kept for diagnostics; not serialized,
 *  so an unchanged extension serializes exactly like its source. */
export type PropertySource =
  | { method: 'declareContextualVars' }
  | { method: 'extend'; call: number }
  | { method: 'from' };

/** One declared custom property: the record every declaration API writes. */
export interface PropertyRecord {
  /** The authored name, without `--`. */
  name: string;
  /** Normalized: the home's default applies when nothing says otherwise. */
  inherits: boolean;
  syntax?: string;
  initialValue?: string;
  home: 'theme';
  source: PropertySource;
  /** Present on records the contextual-variable method made. */
  legacy?: {
    /** The authored registration, projected verbatim into the manifest. */
    registration?: ContextualVarRegistration;
  };
}

/** What makes two registrations of one property the same `@property` rule. */
export interface RegistrationSignature {
  /** The final custom-property name. */
  name: string;
  /** Kept as written, so alternative order is preserved. */
  syntax: string | undefined;
  inherits: boolean;
  initialValue: string | undefined;
}

export interface PropertyStore {
  /**
   * By authored name. A record moves to the end when it first gains a
   * registration, so registered records keep registration order, which is
   * the order their `@property` rules are emitted in.
   */
  records: Map<string, PropertyRecord>;
  /**
   * Names declared on each scale, in declaration order with repeats: the
   * names-by-scale input extraction already reads. Each record's scales are
   * read from here.
   */
  scaleNames: Map<string, string[]>;
}

const THEME_INHERITS = true;

export function createPropertyStore(): PropertyStore {
  return { records: new Map(), scaleNames: new Map() };
}

export function copyPropertyStore(store: PropertyStore): PropertyStore {
  const records = new Map<string, PropertyRecord>();
  for (const [name, record] of store.records) records.set(name, { ...record });
  const scaleNames = new Map<string, string[]>();
  for (const [scale, names] of store.scaleNames) {
    scaleNames.set(scale, [...names]);
  }
  return { records, scaleNames };
}

function ensureRecord(
  store: PropertyStore,
  name: string,
  source: PropertySource
): void {
  if (store.records.has(name)) return;
  store.records.set(name, {
    name,
    inherits: THEME_INHERITS,
    home: 'theme',
    source,
    legacy: {},
  });
}

function isDeclared(store: PropertyStore, name: string): boolean {
  for (const names of store.scaleNames.values()) {
    if (names.includes(name)) return true;
  }
  return false;
}

/** Appends `names` to `scale`, repeats included. */
export function declareScaleNames(
  store: PropertyStore,
  scale: string,
  names: readonly string[],
  source: PropertySource
): void {
  store.scaleNames.set(scale, [
    ...(store.scaleNames.get(scale) ?? []),
    ...names,
  ]);
  for (const name of names) ensureRecord(store, name, source);
}

/** Replaces `scale`'s names in place, dropping records left with neither a
 *  scale nor a registration. */
export function replaceScaleNames(
  store: PropertyStore,
  scale: string,
  names: readonly string[],
  source: PropertySource
): void {
  const replaced = store.scaleNames.get(scale) ?? [];
  store.scaleNames.set(scale, [...names]);
  for (const name of names) ensureRecord(store, name, source);
  for (const name of replaced) {
    const record = store.records.get(name);
    if (record && !record.legacy?.registration && !isDeclared(store, name)) {
      store.records.delete(name);
    }
  }
}

/** The fields a contextual-variable registration sets, read literally: an
 *  untyped registration without a syntax keeps emitting `syntax: "undefined"`,
 *  which extraction reports as an invalid registration. The initial value is
 *  kept as written; extraction writes an all-absolute math one as its
 *  computed value, so the value parser stays out of client bundles. */
function legacyFields(
  registration: ContextualVarRegistration
): Pick<PropertyRecord, 'syntax' | 'inherits' | 'initialValue'> {
  return {
    syntax: `${registration.syntax}`,
    inherits: registration.inherits ?? THEME_INHERITS,
    initialValue: registration.initialValue,
  };
}

export function legacyRegistration(
  store: PropertyStore,
  name: string
): ContextualVarRegistration | undefined {
  return store.records.get(name)?.legacy?.registration;
}

/** Sets a contextual variable's registration; a later one replaces it. */
export function setLegacyRegistration(
  store: PropertyStore,
  name: string,
  registration: ContextualVarRegistration,
  source: PropertySource
): void {
  const existing = store.records.get(name);
  if (existing && !existing.legacy?.registration) store.records.delete(name);
  store.records.set(name, {
    ...(existing ?? { name, home: 'theme', source }),
    ...legacyFields(registration),
    legacy: { registration },
  });
}

/** The one place registration is decided. */
export function isRegistered(record: PropertyRecord): boolean {
  return (
    record.syntax !== undefined ||
    record.initialValue !== undefined ||
    !record.inherits
  );
}

export function registrationSignature(
  record: Pick<PropertyRecord, 'name' | 'syntax' | 'inherits' | 'initialValue'>
): RegistrationSignature {
  return {
    name: `--${record.name}`,
    syntax: record.syntax,
    inherits: record.inherits,
    initialValue: record.initialValue,
  };
}

export function sameRegistration(
  a: RegistrationSignature,
  b: RegistrationSignature
): boolean {
  return (
    a.name === b.name &&
    a.syntax === b.syntax &&
    a.inherits === b.inherits &&
    a.initialValue === b.initialValue
  );
}

/** The signature an incoming contextual-variable registration would have. */
export function legacySignature(
  name: string,
  registration: ContextualVarRegistration
): RegistrationSignature {
  return registrationSignature({ name, ...legacyFields(registration) });
}

/** The names-by-scale input; `undefined` when nothing is declared. */
export function namesByScale(
  store: PropertyStore
): Record<string, string[]> | undefined {
  if (store.scaleNames.size === 0) return undefined;
  const result: Record<string, string[]> = {};
  for (const [scale, names] of store.scaleNames) result[scale] = [...names];
  return result;
}

/** The manifest's `registrations`: authored objects, in registration order. */
export function legacyRegistrations(
  store: PropertyStore
): NonNullable<ThemeManifest['registrations']> {
  const result: NonNullable<ThemeManifest['registrations']> = {};
  for (const [name, record] of store.records) {
    const registration = record.legacy?.registration;
    if (registration) result[name] = registration;
  }
  return result;
}

/**
 * `@property` rules for registered, declared properties, emitted as
 * `--${name}`: the name the Rust resolver maps a bare contextual variable
 * to. `''` when there are none.
 */
export function registrationCss(store: PropertyStore): string {
  const blocks: string[] = [];
  for (const record of store.records.values()) {
    if (!isRegistered(record) || !isDeclared(store, record.name)) continue;
    const signature = registrationSignature(record);
    const descriptors = [
      `syntax: "${signature.syntax}";`,
      `inherits: ${signature.inherits};`,
    ];
    if (signature.initialValue !== undefined) {
      descriptors.push(`initial-value: ${signature.initialValue};`);
    }
    blocks.push(`@property ${signature.name} { ${descriptors.join(' ')} }`);
  }
  return blocks.join('\n');
}

/** The records extraction receives, sorted by name; `undefined` when none. */
export function serializePropertyRecords(
  store: PropertyStore
): string | undefined {
  if (store.records.size === 0) return undefined;
  const records = [...store.records.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((record) => ({
      name: record.name,
      syntax: record.syntax,
      inherits: record.inherits,
      initialValue: record.initialValue,
      scales: [...store.scaleNames]
        .filter(([, names]) => names.includes(record.name))
        .map(([scale]) => scale),
      home: record.home,
      // Whether its `@property` rule is emitted, which needs a declaration.
      registered: isRegistered(record) && isDeclared(store, record.name),
      legacy: record.legacy !== undefined,
    }));
  return JSON.stringify(records);
}
