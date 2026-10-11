/**
 * The runtime module extracted terminals import their factories from.
 */

import type { ProjectManifest } from './manifest-schema';

/** The runtime every adapter emits by default (spine row 1). */
export const DEFAULT_RUNTIME_IMPORT = '@animus-ui/system/runtime';

/** The entries that supply every terminal: an override naming another must
 *  extract only `.asClass()` terminals. */
const FULL_RUNTIME_IMPORTS: ReadonlySet<string> = new Set([
  DEFAULT_RUNTIME_IMPORT,
  '@animus-ui/system',
]);

/** Throws when `runtimeImport` names a module that cannot supply a
 *  terminal the manifest extracted. */
export function assertRuntimeImportSuppliesTerminals(
  runtimeImport: string | undefined,
  manifest: ProjectManifest
): void {
  if (!runtimeImport || FULL_RUNTIME_IMPORTS.has(runtimeImport)) return;
  const offenders: string[] = [];
  for (const [id, descriptor] of Object.entries(manifest.components)) {
    if (
      /\bcreateComponent\(|\bcreateComposedFamily\(/.test(
        descriptor.replacement
      )
    ) {
      offenders.push(id);
    }
  }
  if (offenders.length === 0) return;
  const shown = offenders.slice(0, 5).join(', ');
  throw new Error(
    `[animus-extract] runtimeImport '${runtimeImport}' is valid only when ` +
      `every extracted terminal is .asClass(), but ${offenders.length} ` +
      `component(s) need createComponent/createComposedFamily from the ` +
      `default '${DEFAULT_RUNTIME_IMPORT}' runtime: ${shown}` +
      (offenders.length > 5 ? ', …' : '') +
      `. Remove the override or convert these terminals to .asClass().`
  );
}
