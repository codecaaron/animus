import { parseInternalWire } from './internal-wire';

export type ManifestDiagnostic = {
  file: string;
  component: string;
  kind: string;
  message: string;
  /** Structured token path (`scale.key`); present only on
   *  `external-token-candidate` diagnostics. */
  token?: string;
  code?: string;
  /** `"error"` fails strict builds; `"warn"`/absent never does. Read from
   *  `DIAGNOSTIC_SEVERITY`, never chosen per emission site. */
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

/**
 * A configured source file that could not be read is a LOST INPUT: the
 * emitted artifacts silently lack whatever that file declared.
 */
export function unreadableSourceDiagnostic<Thrown>(
  relPath: string,
  error: Thrown
): ManifestDiagnostic {
  return {
    file: relPath,
    component: 'source',
    kind: 'warn',
    message: `configured source file ${relPath} could not be read and was skipped: ${String(error)}`,
    code: UNREADABLE_SOURCE_FILE,
    severity: severityFor(UNREADABLE_SOURCE_FILE),
  };
}

/** The collision entry code minted by the system package's merge. */
export const VOCABULARY_COLLISION = 'animus.vocabulary.collision';

/** Minted when a sealed kit with registered vocabulary is consumed through
 *  the deprecated `from()`/`includes:` verbs. */
export const VOCABULARY_LEGACY_VERB = 'animus.vocabulary.legacy-verb';

/**
 * A lost or unreadable configured input is `error` — what `--strict`
 * refuses; degradation that still emits complete output is `warn`.
 */
type DiagnosticSeverity = 'error' | 'warn';

const DIAGNOSTIC_SEVERITY: ReadonlyMap<string, DiagnosticSeverity> = new Map([
  [SELECTOR_UNSUPPORTED_SUBJECT, 'error'],
  [UNREADABLE_SOURCE_FILE, 'error'],
  [VOCABULARY_COLLISION, 'warn'],
  [VOCABULARY_LEGACY_VERB, 'warn'],
]);

/** An unlisted code is `warn`: a witness kind from a newer system package
 *  must not fail the strict build of a host that predates its writer. */
function severityFor(code: string | undefined): DiagnosticSeverity {
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
      line = `⚠ ${diagnostic.file}: ${diagnostic.component}: ${diagnostic.message}`;
    }
    if (line === null) continue;
    if (diagnostic.code && !diagnostic.message.includes(diagnostic.code)) {
      line += ` [${diagnostic.code}]`;
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
