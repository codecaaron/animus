/**
 * The system loader's resolution primitives, read from the native engine:
 * the extension policy, the candidates a specifier's base names under it,
 * and what the filesystem holds at a candidate, spelled exactly. One
 * implementation answers for the loader, the extractor and every TS
 * caller.
 */

/** An extension order: what a specifier's base is tried with, in order. */
export interface ExtensionOrder {
  /** Appended to the base, then to `{base}/index`. */
  readonly appended: readonly string[];
  /** An emitted extension, and the source extensions it names, in order,
   *  tried after the literal spelling. */
  readonly nodeNext: ReadonlyArray<
    readonly [emitted: string, sources: readonly string[]]
  >;
  /** A configured alias of an emitted extension: its sequence replaces the
   *  literal try, in order. */
  readonly alias: ReadonlyArray<
    readonly [emitted: string, sequence: readonly string[]]
  >;
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

interface NativeResolution {
  builtInExtensionPolicy(): string;
  specifierCandidates(
    base: string,
    extensionPolicyJson?: string,
    sources?: string[],
    joinedIndex?: boolean
  ): string[];
  seeFile(
    candidate: string,
    within?: string
  ): { kind: string; actual?: string | null };
  probeFile(
    candidates: string[],
    within?: string
  ): {
    kind: string;
    path?: string | null;
    candidate?: string | null;
    actual?: string | null;
  };
}

let loaded: NativeResolution | undefined;

function native(): NativeResolution {
  // SAFETY: the package's own native entry, whose generated `index.d.ts`
  // declares these functions with these signatures.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loaded ??= require('@animus-ui/extract') as NativeResolution;
  return loaded;
}

let builtIn: ExtensionOrder | undefined;

/** The built-in extension policy, as the system loader holds it. */
export function builtInExtensionOrder(): ExtensionOrder {
  // SAFETY: the engine serializes its own ExtensionPolicy, whose fields are
  // these.
  builtIn ??= JSON.parse(native().builtInExtensionPolicy()) as ExtensionOrder;
  return builtIn;
}

/** The files `base` can name, in policy order: itself, with each appended
 *  extension, as a directory's index with each, then the sources its
 *  emitted NodeNext extension stands for (`x.js` names `x.ts`), spelled
 *  exactly. Given `sources`, only extensions in it are tried, and under the
 *  built-in order those it lacks (`.mdx`) follow its own. A configured
 *  alias of the base's suffix replaces all of these. `joinedIndex` spells a
 *  directory's index as a path join does. */
export function specifierCandidates(
  base: string,
  options: {
    readonly sources?: ReadonlySet<string>;
    readonly joinedIndex?: boolean;
    /** A host's extension order (spec §2.2 A2); the built-in policy
     *  without one. */
    readonly policy?: ExtensionOrder;
  } = {}
): string[] {
  const { sources, joinedIndex, policy } = options;
  return native().specifierCandidates(
    base,
    policy === undefined ? undefined : policyJson(policy),
    sources === undefined ? undefined : [...sources],
    joinedIndex
  );
}

/** What the filesystem holds at `candidate`, spelled exactly below the
 *  directory it shares with `within` (from the root without one). `..` is
 *  taken back lexically, as Node and the bundlers resolve a specifier
 *  before opening it. */
export function seeFile(candidate: string, within?: string): SeenFile {
  const seen = native().seeFile(candidate, within);
  if (seen.kind === 'file') return { kind: 'file' };
  if (seen.kind === 'case-only') {
    return { kind: 'case-only', actual: seen.actual ?? candidate };
  }
  return { kind: 'missing' };
}

/** The first of `candidates` the filesystem holds, spelled exactly below
 *  `within` when given; a candidate found only under another case ends the
 *  probe as a mismatch. */
export function probeFile(
  candidates: readonly string[],
  within?: string
): ProbedFile {
  const probed = native().probeFile([...candidates], within);
  if (probed.kind === 'found') return { kind: 'found', path: probed.path! };
  if (probed.kind === 'case-mismatch') {
    return {
      kind: 'case-mismatch',
      candidate: probed.candidate!,
      actual: probed.actual!,
    };
  }
  return { kind: 'absent' };
}

function policyJson(policy: ExtensionOrder): string {
  return JSON.stringify({
    appended: policy.appended,
    nodeNext: policy.nodeNext,
    alias: policy.alias,
  });
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
