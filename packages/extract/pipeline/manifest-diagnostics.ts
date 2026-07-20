export type ManifestDiagnostic = {
  file: string;
  component: string;
  kind: string;
  message: string;
};

/**
 * Surface extraction-manifest diagnostics through a plugin's warn channel.
 *
 * Single authoritative copy for both extraction plugins. Surfaces `bail`
 * (component not extracted), `skip` (component skipped), and `warn` kinds;
 * unknown kinds stay silent.
 */
export function surfaceManifestDiagnostics(
  manifest: { diagnostics?: ManifestDiagnostic[] },
  warn: (message: string) => void
): void {
  for (const diagnostic of manifest.diagnostics ?? []) {
    if (diagnostic.kind === 'bail') {
      warn(`⚠ ${diagnostic.component} not extracted: ${diagnostic.message}`);
    } else if (diagnostic.kind === 'skip') {
      warn(`⚠ ${diagnostic.component}: skipped ${diagnostic.message}`);
    } else if (diagnostic.kind === 'warn') {
      warn(
        `⚠ ${diagnostic.file}: ${diagnostic.component}: ${diagnostic.message}`
      );
    }
  }
}
