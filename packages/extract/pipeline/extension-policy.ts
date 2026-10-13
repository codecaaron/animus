/**
 * The one extension policy: the order in which a relative or aliased
 * specifier's candidate files are tried. Source ingestion reads it here. The
 * system loader and the extractor read `extension_policy.json`, which
 * `node packages/extract/scripts/extension-policy.ts --write` generates from
 * it, so every resolver tries the same files in the same order.
 *
 * The order: the base itself, the base with each appended extension, its
 * `index` with each, then the sources an emitted NodeNext extension stands
 * for (`./x.js` for `x.ts`), spelled exactly.
 */
export const EXTENSION_POLICY = {
  /** Appended to the base, then to `{base}/index`. */
  appended: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
  /** An emitted extension, and the source extensions it names, in order. */
  nodeNext: [
    ['.js', ['.ts', '.tsx', '.jsx']],
    ['.jsx', ['.tsx']],
    ['.mjs', ['.mts']],
    ['.cjs', ['.cts']],
  ],
} as const;
