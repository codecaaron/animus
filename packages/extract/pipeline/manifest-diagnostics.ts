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

/** Stable code for ancestor-subject selector forms (ANI-027). Mirrors the
 *  Rust constant in `extract-v2/src/eval.rs`. */
export const SELECTOR_UNSUPPORTED_SUBJECT =
  'animus.selector.unsupported-subject';

export interface DiagnosticPolicy {
  /** When true, error-severity diagnostics throw instead of warning. */
  strict?: boolean;
  /** System-level diagnostics (e.g. selector-alias validation) surfaced
   *  ahead of the manifest's own, through the same policy. */
  prepend?: ManifestDiagnostic[];
}

/** True when a selector string places its first `&` after an ancestor
 *  prefix — the form extraction cannot represent (leading-`&` is fine). */
export function ancestorSubjectSelector(value: string): boolean {
  const pos = value.indexOf('&');
  return pos > 0;
}

/**
 * Synthesize coded diagnostics for registered selector-alias values whose
 * `&` sits after an ancestor prefix. These never reach the Rust evaluator
 * (aliases are recognized by their `_name` key, then emitted dead), so the
 * system-config boundary is where they must fail loud.
 */
export function collectSelectorAliasDiagnostics(
  selectorAliasesJson: string | null | undefined
): ManifestDiagnostic[] {
  if (!selectorAliasesJson) return [];
  let aliases: Record<string, unknown>;
  try {
    aliases = JSON.parse(selectorAliasesJson);
  } catch {
    return [];
  }
  const diagnostics: ManifestDiagnostic[] = [];
  for (const [name, value] of Object.entries(aliases)) {
    if (typeof value !== 'string') continue;
    for (const branch of value.split(',')) {
      if (ancestorSubjectSelector(branch.trim())) {
        diagnostics.push({
          file: 'system',
          component: name,
          kind: 'warn',
          message: `selector alias '${name}' value '${value}' places '&' after an ancestor prefix (${SELECTOR_UNSUPPORTED_SUBJECT})`,
          code: SELECTOR_UNSUPPORTED_SUBJECT,
          severity: 'error',
        });
        break;
      }
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
