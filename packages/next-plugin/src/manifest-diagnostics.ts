export type ManifestDiagnostic = {
  file: string;
  component: string;
  kind: string;
  message: string;
};

export function surfaceManifestDiagnostics(
  manifest: { diagnostics?: ManifestDiagnostic[] },
  warn: (message: string) => void
): void {
  for (const diagnostic of manifest.diagnostics ?? []) {
    if (diagnostic.kind !== 'warn') continue;
    warn(
      `⚠ ${diagnostic.file}: ${diagnostic.component}: ${diagnostic.message}`
    );
  }
}
