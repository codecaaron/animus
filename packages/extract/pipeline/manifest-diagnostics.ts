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

/** True when the diagnostic reports a chain dropped for an unresolved
 *  parent component. */
export function isUnresolvedParentDrop(diagnostic: {
  message?: unknown;
}): boolean {
  return (
    typeof diagnostic?.message === 'string' &&
    UNRESOLVED_PARENT_RE.test(diagnostic.message)
  );
}

/** The parent binding named by an unresolved-parent drop, or null when the
 *  diagnostic is not one. */
export function unresolvedParentName(diagnostic: {
  message?: unknown;
}): string | null {
  if (typeof diagnostic?.message !== 'string') return null;
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
  const aliases = parseInternalWire<Record<string, unknown>>(
    selectorAliasesJson,
    "selectorAliasesJson (the system loader's selector-alias registry)"
  );
  const diagnostics: ManifestDiagnostic[] = [];
  for (const [name, value] of Object.entries(aliases)) {
    if (typeof value !== 'string') continue;
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
