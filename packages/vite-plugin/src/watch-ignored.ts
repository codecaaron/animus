import { PACKAGE_SRC_EXCLUDES } from '@animus-ui/extract/pipeline';

/** A path as a glob that matches only itself. Each special character
 *  goes in a bracket: the watcher turns every backslash in an ignored
 *  glob into a slash, so a backslash escape would split the path. */
function literal(path: string): string {
  return path.replace(/\\/g, '/').replace(/[()[\]{}*?!+@|]/g, '[$&]');
}

/**
 * `server.watch.ignored` entries that watch installed kits. Vite always
 * ignores every `node_modules` path, where an installed kit lives, and
 * watches what a negated glob names. Each glob names a kit root and the
 * paths under it that ingestion would read: a segment holding an excluded
 * name, the kit's own `node_modules` among them, stays ignored, so the
 * watcher never walks into it. The segment test is a regex lookahead,
 * which picomatch keeps as written.
 */
export function kitWatchNegations(roots: readonly string[]): string[] {
  const excluded = PACKAGE_SRC_EXCLUDES.map((name) => `*${literal(name)}`).join(
    '|'
  );
  return roots.map((root) => `!${literal(root)}*(/(?!${excluded})*)`);
}
