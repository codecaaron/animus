/**
 * Build-failing escalation for `kind: "error"` manifest diagnostics
 * (extraction-diagnostics §Error diagnostics fail the build; design D8 of
 * transform-result-hardening).
 *
 * ONE policy point shared by BOTH bundler plugins: each calls
 * `assertNoErrorDiagnostics` at its analysis-accept seam, immediately after
 * a completed analysis and BEFORE any stylesheet content is served or
 * written. Failure content is composed here, from the diagnostics alone, so
 * identical input produces identical failure messages in every host —
 * plugin policy must not fork (precedent: pkg-collection divergences).
 */

/** The fields of a manifest diagnostic the error gate reads — structural
 *  (fields used only), so both the parsed-manifest entries and TS-side
 *  `ManifestDiagnostic` values qualify. Mirrors the Rust `CssDiagnostic`
 *  in `extract-v2/src/analyze_css.rs`. */
export type CssDiagnosticLike = {
  file: string;
  component: string;
  kind: string;
  message: string;
};

/**
 * Throw when the diagnostics carry any `kind: "error"` entry — one
 * aggregated `Error` naming EVERY offender (component, file, message — one
 * line per entry, each prefixed `[animus]`). Warning-only diagnostics
 * (`bail`/`skip`/`warn`, any severity) never trip this gate; their routing
 * stays with `surfaceManifestDiagnostics`. Callers accept the manifest only
 * past this point, so no stylesheet from a failing analysis is published.
 */
export function assertNoErrorDiagnostics(
  diagnostics: CssDiagnosticLike[] | undefined
): void {
  const errors = (diagnostics ?? []).filter(
    (diagnostic) => diagnostic.kind === 'error'
  );
  if (errors.length === 0) return;
  // The manifest arrives untyped at runtime; the Rust CssDiagnostic declares
  // these fields non-optional, but a hole (or empty string) must not render
  // as "undefined" or "()" — hence || over ??. Byte-identical lines collapse
  // to one: the engine records one entry per resolve position, and repeating
  // the same failure N times is noise, while DISTINCT errors always all
  // print (extraction-diagnostics §Multiple errors reported together).
  const lines = [
    ...new Set(
      errors.map(
        (diagnostic) =>
          `[animus] ${diagnostic.component || '<unknown component>'} (${
            diagnostic.file || '<unknown file>'
          }): ${diagnostic.message || '<no message>'}`
      )
    ),
  ];
  throw new Error(lines.join('\n'));
}
