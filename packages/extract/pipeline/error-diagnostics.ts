export type CssDiagnosticLike = {
  file: string;
  component: string;
  kind: string;
  message: string;
};

export function assertNoErrorDiagnostics(
  diagnostics: CssDiagnosticLike[] | undefined
): void {
  const errors = (diagnostics ?? []).filter(
    (diagnostic) => diagnostic.kind === 'error'
  );
  if (errors.length === 0) return;
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
