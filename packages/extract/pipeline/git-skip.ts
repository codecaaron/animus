import { execFileSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { basename, dirname, extname, join, resolve, sep } from 'path';

import { matchesAnyPattern } from './core-options';
import { specifierCandidates } from './native-resolution';
import { isPathWithinRoot } from './source-identity';

import type { ExtensionOrder } from './native-resolution';
import type { HostReadings } from './probe-evidence';

/** The rule an exclusion's explanation names for a path git keeps out. */
export const GIT_SKIPPED =
  'git: ignored, or in a checkout of its own (analyzeIgnored analyses it)';

const posixKey = (relativePath: string): string =>
  sep === '/' ? relativePath : relativePath.split(sep).join('/');

const git = (rootDir: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });

/**
 * Whether git ignores each path under `rootDir` that exists now, or null
 * where no repository holds the root or git cannot run. One `git ls-files`
 * reads every rule git applies: each `.gitignore`, `.git/info/exclude`, the
 * global `core.excludesFile`, and their negations. A tracked file is never
 * ignored, and a root git ignores itself lists as `./`, which names no path
 * below it. Keys are root-relative with `/`.
 */
export function readGitIgnored(
  rootDir: string
): ((key: string) => boolean) | null {
  let listing: string;
  try {
    listing = git(rootDir, [
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
    ]);
  } catch {
    return null;
  }
  // Every entry ends in NUL: a listing that does not is cut short, and
  // answers nothing.
  if (listing !== '' && !listing.endsWith('\0')) return null;
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const entry of listing.split('\0')) {
    if (entry === '' || entry === './') continue;
    if (entry.endsWith('/')) dirs.add(entry.slice(0, -1));
    else files.add(entry);
  }
  return (key) => {
    if (files.has(key) || dirs.has(key)) return true;
    for (
      let slash = key.indexOf('/');
      slash !== -1;
      slash = key.indexOf('/', slash + 1)
    ) {
      if (dirs.has(key.slice(0, slash))) return true;
    }
    return false;
  };
}

/** Whether git ignores `key` under `rootDir` now: for a path created after
 *  `readGitIgnored` listed what exists. Not where git cannot say. */
function gitIgnoresNow(rootDir: string, key: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', key], {
      cwd: rootDir,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** The `.gitignore` files git reads for `rootDir` and the repository's
 *  exclude file, whose edits change what it ignores, with the repository's
 *  top and that exclude file; none outside a repository. */
function gitIgnoreInputs(
  rootDir: string
): { inputs: string[]; top: string; exclude: string } | null {
  let real: string;
  let top: string;
  let exclude: string;
  try {
    real = realpathSync(rootDir);
    [top, exclude] = git(real, [
      'rev-parse',
      '--show-toplevel',
      '--git-path',
      'info/exclude',
    ])
      .trim()
      .split('\n');
  } catch {
    return null;
  }
  // A linked worktree's exclude file is absolute; a checkout's is relative.
  const excludeFile = resolve(real, exclude);
  const inputs = new Set([excludeFile]);
  // The root's own and its ancestors' up to the repository's top.
  for (let dir = real; ; dir = dirname(dir)) {
    inputs.add(join(dir, '.gitignore'));
    if (dir === top || dirname(dir) === dir) break;
  }
  // Each one below the root that git reads: in a directory it does not
  // ignore.
  try {
    for (const entry of git(real, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ':(glob)**/.gitignore',
    ]).split('\0')) {
      if (entry !== '') inputs.add(join(real, entry));
    }
  } catch {
    // The root's own and its ancestors' still hold.
  }
  return { inputs: [...inputs], top, exclude: excludeFile };
}

/** Whether a directory path could hold one an `analyzeIgnored` pattern
 *  names: below a glob's literal leading segments, or anywhere for a
 *  substring pattern. */
function mayMatchBelow(patterns: readonly string[]): (key: string) => boolean {
  const prefixes = patterns.map((raw) => {
    let pattern = raw.split('\\').join('/');
    while (pattern.startsWith('./')) pattern = pattern.slice(2);
    if (!/[*?]/.test(pattern)) return null;
    const literal: string[] = [];
    for (const segment of pattern.split('/')) {
      if (/[*?]/.test(segment)) break;
      literal.push(segment);
    }
    return literal.join('/');
  });
  return (key) =>
    prefixes.some(
      (prefix) =>
        prefix === null ||
        prefix === '' ||
        key === prefix ||
        key.startsWith(`${prefix}/`) ||
        prefix.startsWith(`${key}/`)
    );
}

/**
 * What git keeps out of one session's analysis, and what it lets back in:
 * paths git ignores and directories below the root that are git checkouts of
 * their own (a worktree's `.git` file or a clone's `.git` directory), except
 * where an analysed file imports them or `analyzeIgnored` names them.
 *
 * Each full pass reads git's listing afresh (`beginPass`), and each walk
 * reads it again before it starts (`beginWalk`), since git lists only what
 * exists. After a walk a path the walk did not see is asked of git once.
 */
export class GitSkip {
  /** Whether git decides anything: off where `analyzeIgnored` names
   *  everything. */
  private authority = false;
  /** Why this pass analyses everything git keeps out, where it failed
   *  open. */
  private open: 'rounds' | 'load' | null = null;
  /** The repository's top and exclude file, where a repository holds the
   *  root. */
  private repository: { top: string; exclude: string } | null = null;
  private rootDir = '';
  private ignored: ((key: string) => boolean) | null = null;
  /** The files the last walk found; null while git's listing is current. */
  private walked: Set<string> | null = null;
  /** What git said of each path created since the last walk. */
  private sinceWalk = new Map<string, boolean>();
  /** Each directory decided, and whether it is a checkout of its own. */
  private checkouts = new Map<string, boolean>();
  private skippedCheckouts: string[] = [];
  /** Root-relative files kept out that an analysed file imports. */
  private pulled = new Set<string>();
  /** The candidates of each probe base no file opened at the last analysis:
   *  a file created at one is one an analysed file imports. */
  private awaited = new Set<string>();
  /** The `.gitignore` and exclude files whose edits change what git keeps
   *  out; empty outside a repository. */
  inputs: string[] = [];
  private readonly kept: (full: string, rel: string) => boolean;
  private readonly keptBelow: ((key: string) => boolean) | null;
  private readonly everything: boolean;

  constructor(
    analyzeIgnored: readonly string[] | undefined,
    private readonly sourceExtensions: ReadonlySet<string>
  ) {
    this.kept = matchesAnyPattern(analyzeIgnored ?? []);
    this.keptBelow =
      analyzeIgnored === undefined ? null : mayMatchBelow(analyzeIgnored);
    this.everything = (analyzeIgnored ?? []).includes('**');
  }

  /** Starts a full pass with `pulled` already let back in. Git decides
   *  only where it answers: with no repository, or a git that fails, nothing
   *  is kept out, a nested checkout included. False then, unless
   *  `analyzeIgnored` names everything. */
  beginPass(rootDir: string, pulled: Iterable<string> = []): boolean {
    this.rootDir = rootDir;
    this.open = null;
    this.pulled = new Set(pulled);
    this.walked = null;
    this.ignored = this.everything ? null : readGitIgnored(rootDir);
    this.authority = this.ignored !== null;
    const inputs = this.authority ? gitIgnoreInputs(rootDir) : null;
    this.inputs = inputs?.inputs ?? [];
    this.repository = inputs && { top: inputs.top, exclude: inputs.exclude };
    return this.authority || this.everything;
  }

  /** Before a walk: git's listing covers every path that exists now. A git
   *  that fails now keeps nothing out. */
  beginWalk(): void {
    if (this.walked !== null && this.ignored !== null) {
      this.ignored = readGitIgnored(this.rootDir);
      if (this.ignored === null) this.authority = false;
    }
    this.walked = null;
    this.checkouts = new Map();
    this.skippedCheckouts = [];
  }

  /** After a walk that found `files` (root-relative). */
  endWalk(files: Iterable<string>): void {
    this.walked = new Set([...files].map(posixKey));
    this.sinceWalk = new Map();
  }

  /** Lets `paths` back in for this pass. */
  pull(paths: Iterable<string>): void {
    for (const path of paths) this.pulled.add(path);
  }

  pulledFiles(): string[] {
    return [...this.pulled].sort();
  }

  /** The rest of this pass analyses everything git keeps out: past the
   *  round bound, or for a load the host cannot list. */
  failOpen(why: 'rounds' | 'load'): void {
    this.open = why;
  }

  private get deciding(): boolean {
    return this.authority && this.open === null;
  }

  /** Whether `path` is a file whose creation, edit or removal changes what
   *  git ignores: a `.gitignore` in the repository, or its exclude file. */
  isIgnoreInput(path: string): boolean {
    const repository = this.repository;
    if (repository === null) return false;
    return (
      (basename(path) === '.gitignore' &&
        (isPathWithinRoot(this.rootDir, path) ||
          isPathWithinRoot(repository.top, path))) ||
      resolve(path) === repository.exclude
    );
  }

  /** Whether `analyzeIgnored` lets a path back in: a file it names, or a
   *  directory one it names may lie below, which the walk then enters. */
  private keptAnyway(full: string, rel: string, key: string): boolean {
    if (this.kept(full, rel)) return true;
    return (
      this.keptBelow !== null &&
      !this.sourceExtensions.has(extname(key)) &&
      this.keptBelow(key)
    );
  }

  /** Whether git keeps a path out: ignored, or below a checkout of its
   *  own, and neither imported nor named by `analyzeIgnored`. */
  skips(full: string, rel: string): boolean {
    if (!this.deciding) return false;
    const key = posixKey(rel);
    if (this.pulled.has(key) || this.awaited.has(key)) return false;
    const skipped =
      (this.ignored?.(key) ?? false) ||
      this.inCheckout(full) ||
      this.ignoredSinceWalk(key);
    return skipped && !this.keptAnyway(full, rel, key);
  }

  /** Whether the walk leaves out a directory it reached: a checkout of its
   *  own. Records the directory for `skips`. */
  skipsDirectory(full: string, rel: string): boolean {
    if (!this.deciding) return false;
    if (!this.isCheckout(full)) return false;
    if (this.keptAnyway(full, rel, posixKey(rel))) return false;
    this.skippedCheckouts.push(posixKey(rel));
    return true;
  }

  private isCheckout(dir: string): boolean {
    let checkout = this.checkouts.get(dir);
    if (checkout === undefined) {
      checkout = existsSync(join(dir, '.git'));
      this.checkouts.set(dir, checkout);
    }
    return checkout;
  }

  /** Whether `full` lies in a directory below the root that is a checkout
   *  of its own. */
  private inCheckout(full: string): boolean {
    if (!isPathWithinRoot(this.rootDir, full)) return false;
    for (
      let dir = dirname(full);
      dir.length > this.rootDir.length;
      dir = dirname(dir)
    ) {
      if (this.isCheckout(dir)) return true;
    }
    return false;
  }

  /** Whether git ignores a path created after its listing: asked once per
   *  path. */
  private ignoredSinceWalk(key: string): boolean {
    if (this.ignored === null || this.walked === null || this.walked.has(key)) {
      return false;
    }
    let ignored = this.sinceWalk.get(key);
    if (ignored === undefined) {
      ignored = gitIgnoresNow(this.rootDir, key);
      this.sinceWalk.set(key, ignored);
    }
    return ignored;
  }

  /** How an analysis reads what git keeps out (`HostReadings`): a probe the
   *  host opens at a kept-out file wants it, unless `excluded` keeps it out
   *  anyway, and each probe base no file opens is awaited. */
  readings(
    order: ExtensionOrder,
    excluded: (full: string, rel: string) => boolean
  ): Pick<HostReadings, 'skipped' | 'missing'> | undefined {
    if (!this.deciding) return undefined;
    const awaited = new Set<string>();
    this.awaited = awaited;
    return {
      skipped: (rel) => {
        const full = resolve(this.rootDir, rel);
        return !excluded(full, rel) && this.skips(full, rel);
      },
      missing: (base) => {
        for (const candidate of specifierCandidates(base.split('?')[0], {
          policy: order,
        })) {
          awaited.add(candidate);
        }
      },
    };
  }

  /** The verbose account of a full pass that took `rounds`, the earlier
   *  ones `earlierMs`; null where git kept nothing out. */
  summary(rounds: number, earlierMs: number): string | null {
    if (this.open === 'rounds') {
      return (
        `git: files git keeps out were still imported after ${rounds - 1} ` +
        `rounds, so this pass analysed every file git ignores`
      );
    }
    if (this.open === 'load') {
      return (
        `git: a computed load the host cannot list exactly may load a file ` +
        `git keeps out, so this pass analysed every file git ignores`
      );
    }
    if (!this.authority) return null;
    const parts = [
      ...(this.ignored === null ? [] : ['paths git ignores']),
      ...(this.skippedCheckouts.length === 0
        ? []
        : [`checkouts of their own (${this.skippedCheckouts.join(', ')})`]),
    ];
    if (parts.length === 0) return null;
    const pulled = this.pulledFiles();
    return (
      `git: skipped ${parts.join(' and ')}` +
      (pulled.length === 0
        ? ''
        : `; analysed ${pulled.length} an analysed file imports ` +
          `(${pulled.join(', ')}) in ${rounds} rounds, the earlier ones ` +
          `taking ${Math.round(earlierMs)}ms`)
    );
  }
}
