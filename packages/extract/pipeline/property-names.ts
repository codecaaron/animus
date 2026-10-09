import { tokenize } from '@animus-ui/properties';

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

/**
 * Gives every custom-property token that names a managed property its final
 * name, in one pass: declaration keys, `var()` reads at any depth (fallbacks
 * included), `@property` names, transition-property lists and style queries.
 * Names are read through the shared CSS tokenizer, whole and with escapes
 * decoded, escaped leading dashes included, so an undeclared identifier that
 * contains or starts with a managed name is never renamed in part. Quoted
 * strings, `url()` and comments are copied unchanged.
 */
export function renameCustomProperties(
  css: string,
  names: PropertyNames
): string {
  let out = '';
  let copied = 0;
  for (const token of tokenize(css)) {
    if (token.type !== 'ident' || !token.value.startsWith('--')) continue;
    const spelling = token.value.slice(2);
    const identity = names.identity(spelling);
    const final =
      identity === undefined ? undefined : names.finalName(identity);
    // A final name spelled with escapes is kept as written.
    if (final === undefined || final === spelling) continue;
    out += `${css.slice(copied, token.start)}--${final}`;
    copied = token.end;
  }
  return out + css.slice(copied);
}
