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
   *  never does. */
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
        severity: 'error',
      });
    }
  }
  return diagnostics;
}

/** Stable code for a vocabulary-record collision witness (mirrors the
 *  entry code minted by @animus-ui/system's merge). */
export const VOCABULARY_COLLISION = 'animus.vocabulary.collision';

/** Stable code for a legacy-verb carriage refusal (a sealed kit with
 *  registered vocabulary consumed through `from()`/`includes:`). */
export const VOCABULARY_LEGACY_VERB = 'animus.vocabulary.legacy-verb';

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
        severity: 'warn',
      });
    } else if (entry.code === VOCABULARY_LEGACY_VERB) {
      diagnostics.push({
        file: 'system',
        component: 'keyframes',
        kind: 'warn',
        message: `a sealed system (${entry.source ?? `'${entry.verb}' source`}) with registered vocabulary [${(entry.names ?? []).join(', ')}] was consumed through the deprecated '${entry.verb}' verb, which cannot carry it — those collections do NOT reach this consumer; use createSystem().extend(source) (${entry.code})`,
        code: entry.code,
        severity: 'warn',
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
        severity: 'warn',
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
