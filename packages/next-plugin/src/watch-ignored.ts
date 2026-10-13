/**
 * webpack's `watchOptions.ignored`, read as Watchpack reads it, so Animus can
 * wrap it: its own epoch file stays ignored, and the files and directories it
 * registers are watched whatever the host ignores (Next ignores every
 * `node_modules` path, where an installed source kit lives).
 */

import { isExcludedPackageRelativePath } from '@animus-ui/extract/pipeline';
import { sep } from 'path';

export type WatchIgnoreEntry = string | RegExp;

export type WatchIgnoreMatcher = (path: string) => boolean;

export type WatchIgnored =
  | WatchIgnoreEntry
  | WatchIgnoreEntry[]
  | WatchIgnoreMatcher
  | null
  | undefined;

/** A webpack config's watch options, as far as Animus reads them. */
export interface WatchOptions {
  ignored?: WatchIgnored;
}

/** The value arrives from a consumer's `next.config`, so the union above is a
 *  model of what webpack accepts, not a proof about the value in hand. */
const isWatchIgnoreString = (ignored: WatchIgnored): ignored is string =>
  Object.prototype.toString.call(ignored) === '[object String]';

const isWatchIgnoreMatcher = (
  ignored: WatchIgnored
): ignored is WatchIgnoreMatcher =>
  Object.prototype.toString.call(ignored) === '[object Function]';

/** A glob as Watchpack compiles it (`glob-to-regexp` with `globstar` and
 *  `extended`, then matching the path or anything under it). */
function globSource(glob: string): string {
  let source = '';
  let inGroup = false;
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    switch (char) {
      case '/':
      case '$':
      case '^':
      case '+':
      case '.':
      case '(':
      case ')':
      case '=':
      case '!':
      case '|':
        source += `\\${char}`;
        break;
      case '?':
        source += '.';
        break;
      case '{':
        inGroup = true;
        source += '(';
        break;
      case '}':
        inGroup = false;
        source += ')';
        break;
      case ',':
        source += inGroup ? '|' : '\\,';
        break;
      case '*': {
        const before = glob[index - 1];
        let stars = 1;
        while (glob[index + 1] === '*') {
          stars += 1;
          index += 1;
        }
        const after = glob[index + 1];
        if (
          stars > 1 &&
          (before === '/' || before === undefined) &&
          (after === '/' || after === undefined)
        ) {
          source += '((?:[^/]*(?:/|$))*)';
          index += 1;
        } else {
          source += '([^/]*)';
        }
        break;
      }
      default:
        source += char;
    }
  }
  return `^${source}(?:$|\\/)`;
}

/** What `ignored` ignores, as Watchpack decides it; nothing when unset. */
export function ignoredMatcher(ignored: WatchIgnored): WatchIgnoreMatcher {
  const slashed = (path: string) => path.replace(/\\/g, '/');
  if (ignored === undefined || ignored === null) return () => false;
  if (isWatchIgnoreMatcher(ignored)) return (path) => Boolean(ignored(path));
  if (ignored instanceof RegExp) return (path) => ignored.test(slashed(path));
  const entries = isWatchIgnoreString(ignored) ? [ignored] : ignored;
  const sources = entries
    .map((entry) =>
      entry instanceof RegExp
        ? entry.source
        : entry.length > 0
          ? globSource(entry)
          : null
    )
    .filter((source): source is string => source !== null);
  if (sources.length === 0) return () => false;
  const pattern = new RegExp(sources.join('|'));
  return (path) => pattern.test(slashed(path));
}

/** Windows paths compare without case, as `path.win32.relative` does. */
const comparable =
  process.platform === 'win32'
    ? (path: string) => path.toLowerCase()
    : (path: string) => path;

/** Whether a path is one of `directories` or lies under one where a kit's
 *  sources can live: never in the kit's own `node_modules` or another path
 *  ingestion excludes, which stay as the host decides. A prefix test:
 *  webpack's watcher asks for every path it watches. */
export function withinDirectories(
  directories: readonly string[]
): (path: string) => boolean {
  // Deepest first: a root admitted inside another decides by its own
  // exclusions, as ingestion does.
  const prefixes = directories
    .map((dir) => comparable(dir.endsWith(sep) ? dir : dir + sep))
    .sort((a, b) => b.length - a.length);
  return (path) => {
    const key = comparable(path) + sep;
    const prefix = prefixes.find((candidate) => key.startsWith(candidate));
    return (
      prefix !== undefined &&
      !isExcludedPackageRelativePath(key.slice(prefix.length))
    );
  };
}
