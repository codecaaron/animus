import { parseInternalWire } from './internal-wire';

export type ManifestDiagnostic = {
  file: string;
  component: string;
  kind: string;
  message: string;
  /** Structured token path (`scale.key`) — present only on
   *  `external-token-candidate` diagnostics (cross-source correlation). */
  token?: string;
  /** Stable diagnostic code (`animus.<namespace>.<slug>`). */
  code?: string;
  /** `"error"` fails strict builds at this policy point; `"warn"`/absent
   *  never does. A property of the diagnostic's code, read from
   *  `DIAGNOSTIC_SEVERITY` below rather than chosen per emission site. */
  severity?: string;
};

/** Stable code for selector forms with no substitutable subject.
 *  Mirrors the Rust constant in `extract-v2/src/eval.rs`. */
export const SELECTOR_UNSUPPORTED_SUBJECT =
  'animus.selector.unsupported-subject';

/** Unresolved-parent chain-drop message (mirrors the Rust diagnostic in
 *  `extract-v2` — the ONE encoding of this message shape; consumers match
 *  through the helpers below, never their own regex copies). */
const UNRESOLVED_PARENT_RE =
  /chain dropped: could not resolve parent component '([^']+)'/;

/** The one field both matchers below read. Named as a slice of the owner
 *  record rather than a private shape so the message channel cannot drift
 *  from the diagnostics these are actually run over — every caller feeds
 *  them entries of a manifest's `diagnostics` array. */
type DiagnosticMessage = Pick<ManifestDiagnostic, 'message'>;

/** True when the diagnostic reports a chain dropped for an unresolved
 *  parent component. */
export function isUnresolvedParentDrop(diagnostic: DiagnosticMessage): boolean {
  return UNRESOLVED_PARENT_RE.test(diagnostic.message);
}

/** The parent binding named by an unresolved-parent drop, or null when the
 *  diagnostic is not one. */
export function unresolvedParentName(
  diagnostic: DiagnosticMessage
): string | null {
  return UNRESOLVED_PARENT_RE.exec(diagnostic.message)?.[1] ?? null;
}

export interface DiagnosticPolicy {
  /** When true, error-severity diagnostics throw instead of warning. */
  strict?: boolean;
  /** System-level diagnostics (e.g. selector-alias validation) surfaced
   *  ahead of the manifest's own, through the same policy. */
  prepend?: ManifestDiagnostic[];
}

/** True when the selector string carries at least one substitutable `&`
 *  subject outside quoted text (mirrors the Rust `selector_subject` walk —
 *  ancestor, leading, and repeated subjects all count; a `&` inside a
 *  quoted attribute value does not). */
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
 * Synthesize coded diagnostics for registered selector-alias values that
 * look selector-shaped (`&` present) but carry no substitutable subject —
 * every `&` sits inside quoted text, so there is nothing to anchor the
 * class to. Ancestor-prefixed and repeated subjects are supported and pass
 * validation. The system-config boundary is where these must fail loud
 * (alias values never reach the evaluator's key guard).
 */
export function collectSelectorAliasDiagnostics(
  selectorAliasesJson: string | null | undefined
): ManifestDiagnostic[] {
  if (!selectorAliasesJson) return [];
  // Fail loud, as the header says: `selectorAliasesJson` is the system
  // loader's own serialization, and an empty diagnostic list reads as "every
  // registered alias validated" — the exact outcome this collector exists to
  // deny.
  //
  // The registry's value type is the producer's, not a guess:
  // `serializeSelectorMap` (@animus-ui/system) writes `alias name → selector
  // string`, flattening each `SelectorAlias` to its `selector` field before
  // `JSON.stringify`. There is no other writer of this wire.
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

/** Stable code for a configured source file the collector could not read. */
export const UNREADABLE_SOURCE_FILE = 'animus.ingestion.unreadable-source-file';

/**
 * The diagnostic for a source file the project configured — one under a
 * package its `includes` graph named — that could not be read, so it never
 * joined the analysis corpus. A lost input: the emitted artifacts are
 * missing whatever that file declared, and nothing downstream can tell that
 * from a file that declared nothing. `error` reaches the same conclusion
 * `--strict` reaches for an unresolvable include. The thrown value comes
 * straight out of the collector's `catch`, so it is stringified, never
 * interpreted.
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

/** Stable code for a vocabulary-record collision witness (mirrors the
 *  entry code minted by @animus-ui/system's merge). */
export const VOCABULARY_COLLISION = 'animus.vocabulary.collision';

/** Stable code for a legacy-verb carriage refusal (a sealed kit with
 *  registered vocabulary consumed through `from()`/`includes:`). */
export const VOCABULARY_LEGACY_VERB = 'animus.vocabulary.legacy-verb';

/**
 * The severity every diagnostic code this host mints carries. One table, so
 * "which code is this" and "does it fail --strict" cannot be answered
 * differently at two emission sites; emission sites must not pick a severity
 * of their own.
 *
 * A code meaning a configured input was lost or unreadable — an include or
 * entry that does not resolve, a file that cannot be read — is `error`: the
 * artifacts are missing content the project asked for, which is what
 * `--strict` refuses. Degradation — a per-property skip, a name collision,
 * an unsupported-value fallback, a deprecated verb dropping what it cannot
 * carry while naming the migration — is `warn`: the input was read and the
 * output is complete, just less than the source hoped for; failing those
 * would contradict the engine's per-property degradation design.
 */
type DiagnosticSeverity = 'error' | 'warn';

const DIAGNOSTIC_SEVERITY: ReadonlyMap<string, DiagnosticSeverity> = new Map([
  [SELECTOR_UNSUPPORTED_SUBJECT, 'error'],
  [UNREADABLE_SOURCE_FILE, 'error'],
  [VOCABULARY_COLLISION, 'warn'],
  [VOCABULARY_LEGACY_VERB, 'warn'],
]);

/** The severity of a diagnostic code. An unlisted code — a witness kind
 *  recorded by a newer @animus-ui/system than this host — is degradation,
 *  never a lost input: it must not fail the strict build of a host that
 *  predates its writer. */
function severityFor(code: string | undefined): DiagnosticSeverity {
  return (
    (code === undefined ? undefined : DIAGNOSTIC_SEVERITY.get(code)) ?? 'warn'
  );
}

/**
 * Map the sealed system's vocabulary witness entries
 * (vocabulary-registration: collision + legacy-verb records, carried on the
 * registration record because the loader's evaluation host shims `console`
 * to a no-op) into coded diagnostics for the shared surfacing policy point.
 * ONE mapper for every host — the witness text must not fork per plugin.
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
      // Fail closed (arch-fail-closed-diagnostics): a witness entry this
      // host does not recognize still surfaces, carrying its own code — a
      // newer @animus-ui/system's witness kind must never vanish silently.
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
 * Surface extraction-manifest diagnostics through a plugin's warn channel.
 *
 * Single authoritative copy for both extraction plugins — and the single
 * strict-escalation policy point: error-severity diagnostics throw one
 * Error naming every offender when `policy.strict`, and print as warnings
 * otherwise. Surfaces `bail` (component not extracted), `skip` (component
 * skipped), and `warn` kinds; unknown kinds stay silent. Printed lines
 * include the diagnostic code when the message doesn't already carry it.
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
