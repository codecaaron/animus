/**
 * The one extension policy: the order in which a relative or aliased
 * specifier's candidate files are tried. Source ingestion reads it here. The
 * system loader and the extractor read `extension_policy.json`, which
 * `node packages/extract/scripts/extension-policy.ts --write` generates from
 * it, so every resolver tries the same files in the same order.
 *
 * The order: the base itself, the base with each appended extension, its
 * `index` with each, then the sources an emitted NodeNext extension stands
 * for (`./x.js` for `x.ts`), matched in any case.
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

const NODE_NEXT_SOURCES: { readonly [emitted: string]: readonly string[] } =
  Object.fromEntries(EXTENSION_POLICY.nodeNext);

const POLICY_EXTENSIONS: readonly string[] = EXTENSION_POLICY.appended;

/** The files `base` can name, in policy order: itself, with each appended
 *  extension, as a directory's index with each, then the sources its
 *  emitted NodeNext extension stands for (`x.js` names `x.ts`), matched in
 *  any case. Given `sources`, only extensions in it are tried, and those
 *  the policy lacks (`.mdx`) follow its own. `index` spells a directory's
 *  index path. */
export function policyCandidates(
  base: string,
  options: {
    readonly sources?: ReadonlySet<string>;
    readonly index?: (directory: string, file: string) => string;
  } = {}
): string[] {
  const { sources, index = (directory, file) => `${directory}/${file}` } =
    options;
  const admitted = (extension: string) => !sources || sources.has(extension);
  const appended = [
    ...POLICY_EXTENSIONS.filter(admitted),
    ...(sources
      ? [...sources].filter((s) => !POLICY_EXTENSIONS.includes(s))
      : []),
  ];
  const name = base.slice(
    Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')) + 1
  );
  const dot = name.lastIndexOf('.');
  const emitted = dot === -1 ? '' : name.slice(dot);
  const nodeNext = (NODE_NEXT_SOURCES[emitted.toLowerCase()] ?? []).filter(
    admitted
  );
  return [
    base,
    ...appended.map((extension) => `${base}${extension}`),
    ...appended.map((extension) => index(base, `index${extension}`)),
    ...nodeNext.map(
      (source) => `${base.slice(0, base.length - emitted.length)}${source}`
    ),
  ];
}
