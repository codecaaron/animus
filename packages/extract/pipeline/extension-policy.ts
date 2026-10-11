import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, normalize, parse, sep } from 'node:path';

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

const NODE_NEXT_SOURCES: { readonly [emitted: string]: readonly string[] } =
  Object.fromEntries(EXTENSION_POLICY.nodeNext);

const POLICY_EXTENSIONS: readonly string[] = EXTENSION_POLICY.appended;

/** The files `base` can name, in policy order: itself, with each appended
 *  extension, as a directory's index with each, then the sources its
 *  emitted NodeNext extension stands for (`x.js` names `x.ts`), spelled
 *  exactly. Given `sources`, only extensions in it are tried, and those
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
  // Exact case, as Node, TypeScript and the hosts read it.
  const nodeNext = (NODE_NEXT_SOURCES[emitted] ?? []).filter(admitted);
  return [
    base,
    ...appended.map((extension) => `${base}${extension}`),
    ...appended.map((extension) => index(base, `index${extension}`)),
    ...nodeNext.map(
      (source) => `${base.slice(0, base.length - emitted.length)}${source}`
    ),
  ];
}

/** What the filesystem holds at a candidate path, spelled exactly. */
export type SeenFile =
  | { kind: 'file' }
  /** A file the filesystem opens under the candidate's spelling though no
   *  directory lists that spelling: its real path, as the filesystem
   *  reports it. */
  | { kind: 'case-only'; actual: string }
  | { kind: 'missing' };

/** How a probe ends. A case mismatch is the first candidate a host opens
 *  under a spelling no directory lists: a case- or normalization-insensitive
 *  host loads it and a sensitive one does not, so it is neither found nor
 *  absent. */
export type ProbedFile =
  | { kind: 'found'; path: string }
  | { kind: 'case-mismatch'; candidate: string; actual: string }
  | { kind: 'absent' };

/** The first of `candidates` that `see` finds, in order; a candidate found
 *  only under another case ends the probe as a mismatch. */
export function probeCandidates(
  candidates: readonly string[],
  see: (candidate: string) => SeenFile
): ProbedFile {
  for (const candidate of candidates) {
    const seen = see(candidate);
    if (seen.kind === 'file') return { kind: 'found', path: candidate };
    if (seen.kind === 'case-only') {
      return { kind: 'case-mismatch', candidate, actual: seen.actual };
    }
  }
  return { kind: 'absent' };
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Whether `directory` lists an entry spelled exactly `name`. */
function lists(directory: string, name: string): boolean {
  try {
    return readdirSync(directory || '.').includes(name);
  } catch {
    return false;
  }
}

/** `path`'s real path as the filesystem reports it; as given when it cannot
 *  be read. */
const reported = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

/** What the filesystem holds at `candidate`: a file it opens under exactly
 *  that spelling, or one it opens although a directory below the one the
 *  candidate shares with `within` lists no entry spelled as the candidate
 *  spells it (a case- or normalization-insensitive filesystem opening
 *  another spelling). Nothing is folded: the filesystem decides what opens,
 *  and its listings decide the spelling, so a file a case-sensitive
 *  filesystem cannot open is simply missing. The shared directory is
 *  spelled as given, as a specifier spells only the path from its
 *  importer's directory and a manifest only the paths in its package. `..`
 *  is taken back lexically, as Node and the bundlers resolve a specifier
 *  before opening it. The system loader reads it alike. */
export function seeOnDisk(candidate: string, within?: string): SeenFile {
  const path = normalize(candidate);
  if (!isFile(path)) return { kind: 'missing' };
  const { root } = parse(path);
  const names = path.slice(root.length).split(sep).filter(Boolean);
  const baseNames =
    within === undefined
      ? []
      : normalize(within).slice(root.length).split(sep).filter(Boolean);
  let shared = 0;
  while (
    shared < baseNames.length &&
    names[shared] === baseNames[shared] &&
    names[shared] !== '..'
  ) {
    shared++;
  }
  let directory = join(root, ...names.slice(0, shared));
  for (const name of names.slice(shared)) {
    if (!lists(directory, name)) {
      return { kind: 'case-only', actual: reported(path) };
    }
    directory = join(directory, name);
  }
  return { kind: 'file' };
}

/** The first of `candidates` the filesystem holds, spelled exactly below
 *  `within` when given. */
export function probeOnDisk(
  candidates: readonly string[],
  within?: string
): ProbedFile {
  return probeCandidates(candidates, (candidate) =>
    seeOnDisk(candidate, within)
  );
}

/** Why `subject` names no file: the file it would load is spelled otherwise
 *  on disk. `remedy` says what to respell. The system loader words it
 *  alike. */
export function caseMismatchReason(
  subject: string,
  mismatch: { candidate: string; actual: string },
  remedy: string
): string {
  return (
    `${subject} names ${mismatch.candidate}, but the file on disk is ` +
    `${mismatch.actual}, spelled differently: a case- or ` +
    `normalization-insensitive filesystem loads it and a sensitive one ` +
    `does not — ${remedy}`
  );
}
