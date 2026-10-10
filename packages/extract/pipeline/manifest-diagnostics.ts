import { UNSUBSTITUTED_ASSET_CODE } from './asset-placeholders';
import { parseInternalWire } from './internal-wire';

import type { ExternalPackageOutcome } from './discover-packages';
import type { SystemConfig } from './system-config';

export type ManifestDiagnostic = {
  file: string;
  component: string;
  kind: string;
  message: string;
  /** Structured token path (`scale.key`); present only on
   *  `external-token-candidate` diagnostics. */
  token?: string;
  code?: string;
  /** `"error"` fails strict builds; `"warn"`/absent never does; `"info"`
   *  prints only at the verbose tier. A property
   *  of the code, never chosen per emission site: `DIAGNOSTIC_SEVERITY` for
   *  codes minted here, the engine's `diagnostic_severity_for_code` for its
   *  own. */
  severity?: string;
  /** 1-based line and column in `file`, where the engine located the record. */
  line?: number;
  column?: number;
  /** The dropped key or expression as written, bounded in length. */
  dropped?: string;
};

/** `file`, then its line and column where the record has them. */
function locationOf(diagnostic: ManifestDiagnostic): string {
  if (diagnostic.line === undefined) return diagnostic.file;
  if (diagnostic.column === undefined) {
    return `${diagnostic.file}:${diagnostic.line}`;
  }
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
}

/** A located record's `file:line:column: `; nothing for one without a line,
 *  whose message names its file. */
function locatedPrefix(diagnostic: ManifestDiagnostic): string {
  return diagnostic.line === undefined ? '' : `${locationOf(diagnostic)}: `;
}

/** What the record dropped, when its message does not already quote it. */
function droppedSuffix(diagnostic: ManifestDiagnostic): string {
  return diagnostic.dropped && !diagnostic.message.includes(diagnostic.dropped)
    ? ` — dropped: ${diagnostic.dropped}`
    : '';
}

/** Stable code for selector forms with no substitutable subject; the
 *  extraction engine mints the same string. */
export const SELECTOR_UNSUPPORTED_SUBJECT =
  'animus.selector.unsupported-subject';

/** The one matcher for the engine's unresolved-parent chain-drop message;
 *  consumers match through the exported helpers, never their own copy. */
const UNRESOLVED_PARENT_RE =
  /chain dropped: could not resolve parent component '([^']+)'/;

type DiagnosticMessage = Pick<ManifestDiagnostic, 'message'>;

export function isUnresolvedParentDrop(diagnostic: DiagnosticMessage): boolean {
  return UNRESOLVED_PARENT_RE.test(diagnostic.message);
}

export function unresolvedParentName(
  diagnostic: DiagnosticMessage
): string | null {
  return UNRESOLVED_PARENT_RE.exec(diagnostic.message)?.[1] ?? null;
}

export interface DiagnosticPolicy {
  /** When true, error-severity diagnostics throw instead of warning. */
  strict?: boolean;
  prepend?: ManifestDiagnostic[];
  /** Receives info-severity lines; without it they are not printed. */
  info?: (message: string) => void;
  /** The levels the host's `diagnostics` option sets. An entry beats
   *  `strict` and the code's own severity. */
  levels?: DiagnosticLevels;
  /** The codes this build knows. With `levels`, a key that matches none of
   *  them warns once. */
  knownCodes?: ReadonlySet<string>;
  /** A development session's error sink: the error-level diagnostics are
   *  reported here instead of thrown, and the session keeps running. Only a
   *  build fails on them. */
  reportErrors?: (message: string) => void;
}

/** What the `diagnostics` option sets a code to, like an ESLint rule level:
 *  `off` prints nothing, `info` and `warn` print at that level, and `error`
 *  fails the build as a strict failure does. */
export type DiagnosticLevel = 'off' | 'info' | 'warn' | 'error';

/** Levels by exact code, by a prefix ending in `.*` (`animus.style.*`), or
 *  by kind (`kind:bail`, `kind:skip`, `kind:warn`, `kind:error`). */
export type DiagnosticLevels = Readonly<Record<string, DiagnosticLevel>>;

export const DIAGNOSTIC_LEVELS: ReadonlySet<string> = new Set([
  'off',
  'info',
  'warn',
  'error',
]);

/** A key that selects every record of a kind: `kind:bail`, `kind:skip`,
 *  `kind:warn` or `kind:error`. */
const KIND_KEY = 'kind:';
const DIAGNOSTIC_KINDS: ReadonlySet<string> = new Set([
  'bail',
  'skip',
  'warn',
  'error',
]);

/** The level `levels` sets for `code`: its exact entry, else the entry of
 *  the longest prefix it starts with. */
function codeLevel(
  code: string | undefined,
  levels: DiagnosticLevels
): DiagnosticLevel | undefined {
  if (code === undefined) return undefined;
  if (Object.hasOwn(levels, code)) return levels[code];
  let longest: { length: number; level: DiagnosticLevel } | undefined;
  for (const [key, level] of Object.entries(levels)) {
    if (!key.endsWith('.*')) continue;
    const prefix = key.slice(0, -1);
    if (code.startsWith(prefix) && prefix.length > (longest?.length ?? -1)) {
      longest = { length: prefix.length, level };
    }
  }
  return longest?.level;
}

/** The level `levels` sets for a record: its code's level, else its kind's. */
function levelFor(
  { code, kind }: Pick<ManifestDiagnostic, 'code' | 'kind'>,
  levels: DiagnosticLevels | undefined
): DiagnosticLevel | undefined {
  if (levels === undefined) return undefined;
  const kindKey = `${KIND_KEY}${kind}`;
  return (
    codeLevel(code, levels) ??
    (Object.hasOwn(levels, kindKey) ? levels[kindKey] : undefined)
  );
}

/** The level a record prints at: the option's entry for its code, else
 *  `error` for a hard error (an `error`-kind record) or an error-severity
 *  record under `strict`, else its own. */
export function effectiveLevel(
  diagnostic: ManifestDiagnostic,
  policy: Pick<DiagnosticPolicy, 'levels' | 'strict'>
): DiagnosticLevel {
  const level = levelFor(diagnostic, policy.levels);
  if (level !== undefined) return level;
  if (diagnostic.kind === 'error') return 'error';
  if (diagnostic.severity === 'info') return 'info';
  return policy.strict && diagnostic.severity === 'error' ? 'error' : 'warn';
}

/** Every code Animus is known to report: the engine's table, as the native
 *  module publishes it (`diagnosticCodes()`), the pipeline's, and the asset
 *  code. The system package mints vocabulary codes at run time, so a valid
 *  code can be missing. */
export function knownDiagnosticCodes(
  engineCodesJson: string | undefined
): ReadonlySet<string> {
  const engineCodes = engineCodesJson
    ? Object.keys(
        parseInternalWire<Record<string, string>>(
          engineCodesJson,
          'diagnosticCodes (the engine code table)'
        )
      )
    : [];
  return new Set([
    ...engineCodes,
    ...DIAGNOSTIC_SEVERITY.keys(),
    UNSUBSTITUTED_ASSET_CODE,
  ]);
}

/** The keys of `levels` that name no known code, exactly or as a prefix. */
function unknownDiagnosticKeys(
  levels: DiagnosticLevels,
  known: ReadonlySet<string>
): string[] {
  return Object.keys(levels).filter((key) => {
    if (key.startsWith(KIND_KEY)) {
      return !DIAGNOSTIC_KINDS.has(key.slice(KIND_KEY.length));
    }
    if (!key.endsWith('.*')) return !known.has(key);
    const prefix = key.slice(0, -1);
    return ![...known].some((code) => code.startsWith(prefix));
  });
}

/** The failure of diagnostics at `error` level, from `strict` or the
 *  `diagnostics` option: a host fails the build on it whatever its own
 *  strictness. It prints as the plain `Error` strict always threw. */
export class DiagnosticFailure extends Error {}

/** Level options already checked against the known codes: one warning per
 *  unknown key, however often a host analyzes. */
const checkedLevels = new WeakSet<DiagnosticLevels>();

/** True when the selector carries at least one substitutable `&` subject
 *  outside quoted text. */
export function hasSelectorSubject(value: string): boolean {
  let quote: string | null = null;
  let escaped = false;
  for (const c of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '&') {
      return true;
    }
  }
  return false;
}

/**
 * Coded diagnostics for selector-shaped alias values with no substitutable
 * subject; alias values never reach the evaluator's own key guard.
 */
export function collectSelectorAliasDiagnostics(
  selectorAliasesJson: string | null | undefined
): ManifestDiagnostic[] {
  if (!selectorAliasesJson) return [];
  // A parse failure throws: an empty diagnostic list reads as "every
  // registered alias validated", the outcome this collector exists to deny.
  const aliases = parseInternalWire<Record<string, string>>(
    selectorAliasesJson,
    "selectorAliasesJson (the system loader's selector-alias registry)"
  );
  const diagnostics: ManifestDiagnostic[] = [];
  for (const [name, value] of Object.entries(aliases)) {
    if (value.includes('&') && !hasSelectorSubject(value)) {
      diagnostics.push({
        file: 'system',
        component: name,
        kind: 'warn',
        message: `selector alias '${name}' value '${value}' has no substitutable '&' subject outside quoted text (${SELECTOR_UNSUPPORTED_SUBJECT})`,
        code: SELECTOR_UNSUPPORTED_SUBJECT,
        severity: severityFor(SELECTOR_UNSUPPORTED_SUBJECT),
      });
    }
  }
  return diagnostics;
}

export const UNREADABLE_SOURCE_FILE = 'animus.ingestion.unreadable-source-file';

/** A kit the system extends resolved, yet discovery found none of its files. */
export const NO_KIT_FILES = 'animus.discovery.no-kit-files';

/** A kit with no `animus` export condition: discovery guesses its source
 *  from `src/`. */
export const KIT_WITHOUT_SOURCE_CONDITION =
  'animus.discovery.kit-without-source-condition';

/** A kit's `animus` export condition names a file that is missing or outside
 *  its package, so that entry is not read from source. */
export const INVALID_KIT_SOURCE_CONDITION =
  'animus.discovery.invalid-source-condition';

/** A kit the application imports whose system the application's system
 *  does not include: its components are not extracted. */
export const KIT_SYSTEM_NOT_INCLUDED = 'animus.kit.system-not-included';

/** A system file's `createSystem` binding that discovery could not follow to
 *  Animus's factory, so it is no root. */
export const UNPROVEN_ROOT_BINDING = 'animus.discovery.unproven-root-binding';

/** What a skipped source file costs: the analysis never sees what it
 *  renders. */
export const SKIPPED_SOURCE_COST =
  'skipped: its renders are not seen, so nothing is pruned and every component, variant option and state is kept until it is analyzed';

/**
 * A configured source file that could not be read is a LOST INPUT: the
 * emitted artifacts silently lack whatever that file declared.
 */
/** Whether a failed source read means the file was deleted after discovery
 *  (an editor's delete-and-recreate, a branch switch): a deletion, not lost
 *  input. */
export function isDeletedSource<Thrown>(error: Thrown): boolean {
  // SAFETY: `error` is a failed read's throw; `?.code` reads through whatever
  // it is and only `ENOENT` is acted on.
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function unreadableSourceDiagnostic<Thrown>(
  relPath: string,
  error: Thrown
): ManifestDiagnostic {
  return {
    file: relPath,
    component: 'source',
    kind: 'warn',
    message: `configured source file ${relPath} could not be read: ${String(error)} (${SKIPPED_SOURCE_COST})`,
    code: UNREADABLE_SOURCE_FILE,
    severity: severityFor(UNREADABLE_SOURCE_FILE),
  };
}

/** One warning per kit the system extends that resolved, yet yielded no
 *  files: none of its components are extracted. */
export function noKitFilesDiagnostics(
  outcomes: readonly ExternalPackageOutcome[]
): ManifestDiagnostic[] {
  return outcomes
    .filter((record) => record.outcome === 'empty')
    .map((record) => ({
      file: record.specifier,
      component: 'kit',
      kind: 'warn',
      message:
        'resolved, but discovery found none of its files, so none of its components are extracted — check that the package ships its src/ directory or a readable entry',
      code: NO_KIT_FILES,
      severity: severityFor(NO_KIT_FILES),
    }));
}

/** The collision entry code minted by the system package's merge. */
export const VOCABULARY_COLLISION = 'animus.vocabulary.collision';

/** A theme `@property` registration browsers would ignore; it is not emitted. */
export const INVALID_PROPERTY_REGISTRATION =
  'animus.theme.invalid-property-registration';

/** Minted when a sealed kit with registered vocabulary is consumed through
 *  the deprecated `from()`/`includes:` verbs. */
export const VOCABULARY_LEGACY_VERB = 'animus.vocabulary.legacy-verb';

/** A `var()` fallback that never applies: the property is registered with an
 *  initial value. */
export const PROPERTY_FALLBACK_SUPPRESSED =
  'animus.property.fallback-suppressed';

/** The same, where the fallback heads a chain of further `var()` reads. */
export const PROPERTY_FALLBACK_CHAIN_SUPPRESSED =
  'animus.property.fallback-chain-suppressed';

/** A declared property set in keyframes or transitioned without a typed
 *  registration, so it does not interpolate. */
export const PROPERTY_UNREGISTERED_ANIMATION =
  'animus.property.unregistered-animation';

/** A custom property whose resolved value is `var()` of itself, which makes
 *  it invalid at computed-value time. */
export const PROPERTY_SELF_REFERENCE = 'animus.property.self-reference';

/** A custom property that reads itself only inside another `var()`'s
 *  fallback: cyclic wherever that fallback is used. */
export const PROPERTY_FALLBACK_SELF_REFERENCE =
  'animus.property.fallback-self-reference';

/** Custom properties that `currentVar` writes in one rule, each reading
 *  another directly, so every property in the cycle is invalid at
 *  computed-value time. */
export const PROPERTY_CURRENT_VAR_CYCLE = 'animus.property.current-var-cycle';

/** A prefix renamed contextual variables without `prefixContextualVars`, so
 *  their declared names no longer resolve. */
export const PREFIX_CONTEXTUAL_VARS_UNPREFIXED =
  'animus.prefix.contextual-vars-unprefixed';

/** Under `prefixContextualVars`, a final name that collides with a runtime
 *  transport variable or a theme variable of the same spelling. */
export const PREFIX_NAME_CONFLICT = 'animus.prefix.name-conflict';

/** A contextual variable declared on a scale that also holds a token of its
 *  name: scale reads resolve to the token. */
export const PROPERTY_LEGACY_TOKEN_COLLISION =
  'animus.property.legacy-token-collision';

/** A theme property declared on a scale that also holds a token of its
 *  name. */
export const PROPERTY_TOKEN_COLLISION = 'animus.property.token-collision';

/**
 * A lost or unreadable configured input, or a classified unsupported Animus
 * declaration, is `error` — what `--strict` refuses; degradation that still
 * emits complete output is `warn`; output that may be intended is `info`.
 */
type DiagnosticSeverity = 'error' | 'warn' | 'info';

const DIAGNOSTIC_SEVERITY: ReadonlyMap<string, DiagnosticSeverity> = new Map([
  [SELECTOR_UNSUPPORTED_SUBJECT, 'error'],
  [UNREADABLE_SOURCE_FILE, 'error'],
  [NO_KIT_FILES, 'warn'],
  [KIT_WITHOUT_SOURCE_CONDITION, 'warn'],
  [INVALID_KIT_SOURCE_CONDITION, 'error'],
  [KIT_SYSTEM_NOT_INCLUDED, 'error'],
  [UNPROVEN_ROOT_BINDING, 'warn'],
  [VOCABULARY_COLLISION, 'warn'],
  [VOCABULARY_LEGACY_VERB, 'warn'],
  [INVALID_PROPERTY_REGISTRATION, 'error'],
  [PROPERTY_FALLBACK_SUPPRESSED, 'info'],
  [PROPERTY_FALLBACK_CHAIN_SUPPRESSED, 'warn'],
  [PROPERTY_UNREGISTERED_ANIMATION, 'info'],
  [PROPERTY_SELF_REFERENCE, 'warn'],
  [PROPERTY_FALLBACK_SELF_REFERENCE, 'warn'],
  [PROPERTY_CURRENT_VAR_CYCLE, 'warn'],
  [PREFIX_CONTEXTUAL_VARS_UNPREFIXED, 'warn'],
  [PREFIX_NAME_CONFLICT, 'error'],
  [PROPERTY_LEGACY_TOKEN_COLLISION, 'warn'],
  [PROPERTY_TOKEN_COLLISION, 'error'],
]);

/** An unlisted code is `warn`: a witness kind from a newer system package
 *  must not fail the strict build of a host that predates its writer. */
export function severityFor(code: string | undefined): DiagnosticSeverity {
  return (
    (code === undefined ? undefined : DIAGNOSTIC_SEVERITY.get(code)) ?? 'warn'
  );
}

/**
 * The one mapper of a sealed system's witness entries for every host: the
 * loader's evaluation host shims `console`, so the record is the channel.
 */
export function vocabularyWitnessDiagnostics(
  vocabularyWitnessesJson: string | null | undefined
): ManifestDiagnostic[] {
  if (!vocabularyWitnessesJson) return [];
  const entries = parseInternalWire<
    Array<{
      code?: string;
      name?: string;
      winner?: string;
      loser?: string;
      verb?: string;
      source?: string;
      names?: string[];
    }>
  >(
    vocabularyWitnessesJson,
    "vocabularyWitnessesJson (the sealed system's vocabulary witness record)"
  );
  const diagnostics: ManifestDiagnostic[] = [];
  for (const entry of entries) {
    if (entry.code === VOCABULARY_COLLISION) {
      diagnostics.push({
        file: 'system',
        component: entry.name ?? 'keyframes',
        kind: 'warn',
        message: `keyframes vocabulary "${entry.name}" is registered by both ${entry.loser} and ${entry.winner} — ${entry.winner} wins; rename one collection (${entry.code})`,
        code: entry.code,
        severity: severityFor(entry.code),
      });
    } else if (entry.code === VOCABULARY_LEGACY_VERB) {
      diagnostics.push({
        file: 'system',
        component: 'keyframes',
        kind: 'warn',
        message: `a sealed system (${entry.source ?? `'${entry.verb}' source`}) with registered vocabulary [${(entry.names ?? []).join(', ')}] was consumed through the deprecated '${entry.verb}' verb, which cannot carry it — those collections do NOT reach this consumer; use createSystem().extend(source) (${entry.code})`,
        code: entry.code,
        severity: severityFor(entry.code),
      });
    } else {
      diagnostics.push({
        file: 'system',
        component: 'vocabulary',
        kind: 'warn',
        message: `unrecognized vocabulary witness entry ${JSON.stringify(entry)} — a newer @animus-ui/system may have recorded a witness kind this host predates${entry.code ? ` (${entry.code})` : ''}`,
        code: entry.code,
        severity: severityFor(entry.code),
      });
    }
  }
  return diagnostics;
}

/** The diagnostics a loaded system's own records carry: vocabulary
 *  witnesses and invalid `@property` registrations. */
export function systemLoadDiagnostics(
  system: Pick<
    SystemConfig,
    | 'vocabularyWitnessesJson'
    | 'invalidPropertyRegistrations'
    | 'legacyPrefixedContextualVars'
    | 'prefixNameConflicts'
    | 'scalesJson'
    | 'propertyRecordsJson'
  >
): ManifestDiagnostic[] {
  const registrations = (system.invalidPropertyRegistrations ?? []).map(
    ({ name, reason }): ManifestDiagnostic => ({
      file: 'system',
      component: name,
      kind: 'warn',
      message: `@property ${name} was not emitted: ${reason}. Browsers ignore an invalid registration and minifying it fails; fix it where the theme declares ${name} (${INVALID_PROPERTY_REGISTRATION})`,
      code: INVALID_PROPERTY_REGISTRATION,
      severity: severityFor(INVALID_PROPERTY_REGISTRATION),
    })
  );
  const prefixed = system.legacyPrefixedContextualVars ?? [];
  const unprefixed: ManifestDiagnostic[] =
    prefixed.length === 0
      ? []
      : [
          {
            file: 'system',
            component: 'prefix',
            kind: 'warn',
            message: `the prefix renames the contextual variables ${prefixed.join(', ')}, but their declared names are still read and written as written, so scale reads of them fail and their writes miss. Set prefixContextualVars: true to resolve them under the prefix (${PREFIX_CONTEXTUAL_VARS_UNPREFIXED})`,
            code: PREFIX_CONTEXTUAL_VARS_UNPREFIXED,
            severity: severityFor(PREFIX_CONTEXTUAL_VARS_UNPREFIXED),
          },
        ];
  // A conflict leaves the emitted names ambiguous, so it is an error in
  // every mode, never a warning.
  const conflicts = (system.prefixNameConflicts ?? []).map(
    ({ name, final, reason }): ManifestDiagnostic => ({
      file: 'system',
      component: `--${name}`,
      kind: 'error',
      message:
        reason === 'transport'
          ? `the prefix would emit the contextual variable ${name} as --${final}, inside the --animus- names of the runtime's transport variables, where it can collide with a prop's own variable. Use a different prefix (${PREFIX_NAME_CONFLICT})`
          : `the theme variable --${name} is spelled like the final name of the contextual variable ${final}, so under prefixContextualVars a reference to --${name} reaches ${final} and the theme variable is unreachable. Rename one of them (${PREFIX_NAME_CONFLICT})`,
      code: PREFIX_NAME_CONFLICT,
      severity: severityFor(PREFIX_NAME_CONFLICT),
    })
  );
  return [
    ...vocabularyWitnessDiagnostics(system.vocabularyWitnessesJson),
    ...registrations,
    ...unprefixed,
    ...conflicts,
    ...tokenCollisionDiagnostics(system),
  ];
}

/**
 * Each declared property whose name is also a token on a scale it is
 * declared on. A scale read of that key, a prop value or a `{scale.key}`
 * reference, resolves to the token, so the property is unreachable through
 * the scale. A legacy declaration warns and the token stays the winner; any
 * other is an error in every mode.
 */
function tokenCollisionDiagnostics(
  system: Pick<SystemConfig, 'scalesJson' | 'propertyRecordsJson'>
): ManifestDiagnostic[] {
  if (!system.propertyRecordsJson) return [];
  const records = parseInternalWire<
    Array<{ name: string; scales: string[]; legacy: boolean }>
  >(system.propertyRecordsJson, "propertyRecordsJson (the theme's properties)");
  const declared = records.flatMap((record) =>
    record.scales.map((scale) => ({
      record,
      scale,
      path: `${scale}.${record.name}`,
    }))
  );
  if (declared.length === 0) return [];
  const tokens = parseInternalWire<Record<string, string>>(
    system.scalesJson,
    "scalesJson (the theme's scale tokens)"
  );
  return declared
    .filter(({ path }) => Object.hasOwn(tokens, path))
    .map(({ record, scale, path }): ManifestDiagnostic => {
      const code = record.legacy
        ? PROPERTY_LEGACY_TOKEN_COLLISION
        : PROPERTY_TOKEN_COLLISION;
      const declaration = record.legacy
        ? `the contextual variable ${record.name}, which declareContextualVars declares on ${scale},`
        : `the theme property ${record.name}, declared on ${scale},`;
      return {
        file: 'system',
        component: path,
        kind: record.legacy ? 'warn' : 'error',
        message: `the ${scale} token ${record.name} (${tokens[path]}) and ${declaration} share this key. A scale read of it, such as {${path}} or a prop on the ${scale} scale set to '${record.name}', resolves to the token, so the ${record.legacy ? 'contextual variable' : 'property'} is unreachable through ${scale}. Rename one of them (${code})`,
        code,
        severity: severityFor(code),
      };
    });
}

/**
 * The single strict-escalation policy point for both extraction plugins:
 * error-severity diagnostics throw together under `strict`, else warn. A
 * development session reports them through `reportErrors` instead.
 */
export function surfaceManifestDiagnostics(
  manifest: { diagnostics?: ManifestDiagnostic[] },
  warn: (message: string) => void,
  policy: DiagnosticPolicy = {}
): void {
  // A Set: a system's hard error arrives both prepended and in the manifest.
  const errors = new Set<string>();
  if (policy.levels && policy.knownCodes && !checkedLevels.has(policy.levels)) {
    checkedLevels.add(policy.levels);
    for (const key of unknownDiagnosticKeys(policy.levels, policy.knownCodes)) {
      warn(
        key.startsWith(KIND_KEY)
          ? `⚠ diagnostics option: '${key}' names no diagnostic kind — use kind:bail, kind:skip, kind:warn or kind:error`
          : `⚠ diagnostics option: '${key}' matches no Animus diagnostic code — check its spelling (a code the system package mints at run time is known only once it is reported)`
      );
    }
  }
  const diagnostics = policy.prepend?.length
    ? [...policy.prepend, ...(manifest.diagnostics ?? [])]
    : (manifest.diagnostics ?? []);
  for (const diagnostic of diagnostics) {
    const level = effectiveLevel(diagnostic, policy);
    if (level === 'off') continue;
    let line: string | null = null;
    const mark = level === 'info' ? 'ℹ' : '⚠';
    const message = `${diagnostic.message}${droppedSuffix(diagnostic)}`;
    if (diagnostic.kind === 'bail') {
      line = `${mark} ${locatedPrefix(diagnostic)}${diagnostic.component} not extracted: ${message}`;
    } else if (diagnostic.kind === 'skip') {
      line = `${mark} ${locatedPrefix(diagnostic)}${diagnostic.component}: skipped ${message}`;
    } else if (diagnostic.kind === 'warn' || diagnostic.kind === 'error') {
      line = `${mark} ${locationOf(diagnostic)}: ${diagnostic.component}: ${message}`;
    }
    if (line === null) continue;
    if (diagnostic.code && !diagnostic.message.includes(diagnostic.code)) {
      line += ` [${diagnostic.code}]`;
    }
    if (level === 'info') {
      policy.info?.(line);
      continue;
    }
    if (level === 'error') {
      // A hard error's message does not name its file, so it keeps it.
      const subject =
        diagnostic.kind === 'error'
          ? `${locationOf(diagnostic)}: `
          : locatedPrefix(diagnostic);
      errors.add(
        `${diagnostic.code ?? 'error'} — ${subject}${diagnostic.component}: ${message}`
      );
      continue;
    }
    warn(line);
  }
  if (errors.size === 0) return;
  const message = `[animus] strict: ${errors.size} error diagnostic(s):\n${[...errors].join('\n')}`;
  if (policy.reportErrors) {
    policy.reportErrors(message);
    return;
  }
  throw new DiagnosticFailure(message);
}
