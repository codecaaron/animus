export interface PathAliasEntry {
  pattern: string;
  replacement: string;
  type: 'prefix' | 'exact';
}

export interface PathAliasPair {
  pattern: string;
  target: string;
  kind?: 'prefix' | 'exact';
}

export function buildPathAliasesJson(
  pairs: PathAliasPair[],
  rootDir: string
): { json: string; count: number } | null {
  const entries: PathAliasEntry[] = [];

  for (const { pattern, target, kind } of pairs) {
    const replacement = target.startsWith(rootDir)
      ? target.slice(rootDir.length + 1)
      : target;
    const isExact = kind ? kind === 'exact' : /\.\w+$/.test(replacement);
    if (isExact) {
      entries.push({ pattern, replacement, type: 'exact' });
    } else {
      entries.push({
        pattern: pattern.endsWith('/') ? pattern : pattern + '/',
        replacement: replacement.endsWith('/')
          ? replacement
          : replacement + '/',
        type: 'prefix',
      });
    }
  }

  entries.sort((a, b) => b.pattern.length - a.pattern.length);

  if (entries.length === 0) return null;
  return { json: JSON.stringify({ aliases: entries }), count: entries.length };
}
