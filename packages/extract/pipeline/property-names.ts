/**
 * The one map from a managed property's declared name to its final name.
 * Names carry no `--`. Lookups go by identity: a declared contextual
 * variable, the exact final spelling of one, which still resolves as a
 * compatibility alias, or another name the theme defines. A declared name
 * wins over another name's final spelling, and an alias over a theme name,
 * as the extractor's index rules, so nothing is renamed twice and both
 * sides resolve every spelling alike.
 */
export interface PropertyNames {
  /** The declared name a spelling refers to; `undefined` when unmanaged. */
  identity(spelling: string): string | undefined;
  /** The final name of a declared name; `undefined` when unmanaged. */
  finalName(declared: string): string | undefined;
  /** Theme names that are also a contextual variable's final spelling. */
  ambiguous(): Array<{ name: string; contextual: string }>;
}

export function createPropertyNames(
  declared: Iterable<string>,
  prefix: string,
  themeNames: Iterable<string> = []
): PropertyNames {
  const finals = new Map<string, string>();
  for (const name of [...new Set(declared)].sort()) {
    finals.set(name, `${prefix}-${name}`);
  }
  const aliases = new Map<string, string>();
  for (const [name, final] of finals) {
    if (!finals.has(final)) aliases.set(final, name);
  }
  const others = new Map<string, string>();
  for (const name of [...new Set(themeNames)].sort()) {
    if (!finals.has(name)) others.set(name, `${prefix}-${name}`);
  }
  return {
    identity: (spelling) =>
      finals.has(spelling)
        ? spelling
        : (aliases.get(spelling) ??
          (others.has(spelling) ? spelling : undefined)),
    finalName: (name) => finals.get(name) ?? others.get(name),
    ambiguous: () =>
      [...others.keys()]
        .filter((name) => aliases.has(name))
        .map((name) => ({ name, contextual: aliases.get(name) ?? name })),
  };
}

const NAME_CHAR = /[\w-]/;

/**
 * Gives every custom-property token that names a managed property its final
 * name, in one pass: declaration keys, `var()` reads at any depth (fallbacks
 * included), `@property` names, transition-property lists and style queries.
 * Quoted strings, `url()` and comments are copied unchanged.
 */
export function renameCustomProperties(
  css: string,
  names: PropertyNames
): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = closingQuote(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i + 2);
      const end = close === -1 ? css.length : close + 2;
      out += css.slice(i, end);
      i = end;
    } else if (/^url\(/i.test(css.slice(i, i + 4)) && !isNameChar(css[i - 1])) {
      const end = closingUrl(css, i + 4);
      out += css.slice(i, end);
      i = end;
    } else if (css.startsWith('--', i) && !isNameChar(css[i - 1])) {
      let end = i + 2;
      while (end < css.length && NAME_CHAR.test(css[end])) end += 1;
      const spelling = css.slice(i + 2, end);
      const identity = names.identity(spelling);
      const final =
        identity === undefined ? undefined : names.finalName(identity);
      out += `--${final ?? spelling}`;
      i = end;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function isNameChar(c: string | undefined): boolean {
  return c !== undefined && NAME_CHAR.test(c);
}

function closingQuote(css: string, open: number): number {
  const quote = css[open];
  let i = open + 1;
  while (i < css.length && css[i] !== quote) {
    i += css[i] === '\\' ? 2 : 1;
  }
  return Math.min(i + 1, css.length);
}

/** The index after the `)` that closes an unquoted or quoted `url(`. */
function closingUrl(css: string, from: number): number {
  let i = from;
  while (i < css.length && css[i] !== ')') {
    i = css[i] === '"' || css[i] === "'" ? closingQuote(css, i) : i + 1;
  }
  return Math.min(i + 1, css.length);
}
