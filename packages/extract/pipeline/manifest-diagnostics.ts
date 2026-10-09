import { parseInternalWire } from './internal-wire';

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
};

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
}

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

/**
 * A lost or unreadable configured input, or a classified unsupported Animus
 * declaration, is `error` — what `--strict` refuses; degradation that still
 * emits complete output is `warn`; output that may be intended is `info`.
 */
type DiagnosticSeverity = 'error' | 'warn' | 'info';

const DIAGNOSTIC_SEVERITY: ReadonlyMap<string, DiagnosticSeverity> = new Map([
  [SELECTOR_UNSUPPORTED_SUBJECT, 'error'],
  [UNREADABLE_SOURCE_FILE, 'error'],
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
  ];
}

/**
 * The single strict-escalation policy point for both extraction plugins:
 * error-severity diagnostics throw together under `strict`, else warn.
 */
export function surfaceManifestDiagnostics(
  manifest: { diagnostics?: ManifestDiagnostic[] },
  warn: (message: string) => void,
  policy: DiagnosticPolicy = {}
): void {
  const errors: string[] = [];
  const diagnostics = policy.prepend?.length
    ? [...policy.prepend, ...(manifest.diagnostics ?? [])]
    : (manifest.diagnostics ?? []);
  for (const diagnostic of diagnostics) {
    let line: string | null = null;
    if (diagnostic.kind === 'bail') {
      line = `⚠ ${diagnostic.component} not extracted: ${diagnostic.message}`;
    } else if (diagnostic.kind === 'skip') {
      line = `⚠ ${diagnostic.component}: skipped ${diagnostic.message}`;
    } else if (diagnostic.kind === 'warn') {
      const mark = diagnostic.severity === 'info' ? 'ℹ' : '⚠';
      line = `${mark} ${diagnostic.file}: ${diagnostic.component}: ${diagnostic.message}`;
    }
    if (line === null) continue;
    if (diagnostic.code && !diagnostic.message.includes(diagnostic.code)) {
      line += ` [${diagnostic.code}]`;
    }
    if (diagnostic.severity === 'info') {
      policy.info?.(line);
      continue;
    }
    if (policy.strict && diagnostic.severity === 'error') {
      errors.push(
        `${diagnostic.code ?? 'error'} — ${diagnostic.component}: ${diagnostic.message}`
      );
      continue;
    }
    warn(line);
  }
  if (errors.length > 0) {
    throw new Error(
      `[animus] strict: ${errors.length} error diagnostic(s):\n${errors.join('\n')}`
    );
  }
}
