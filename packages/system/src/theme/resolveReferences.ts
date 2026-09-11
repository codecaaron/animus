/**
 * Runs inside QuickJS: ES built-ins only, no Node or WHATWG APIs.
 */

const TOKEN_REF_RE = /\{([^}]+)\}/g;

interface ParsedReference {
  text: string;
  path: string;
  opacity?: string;
}

const UNVISITED = 0;
const RESOLVING = 1;
const RESOLVED = 2;

/** `matchAll`, not `exec`: a shared global regex would carry `lastIndex`. */
function parseReferences(value: string): ParsedReference[] {
  const references: ParsedReference[] = [];
  for (const match of value.matchAll(TOKEN_REF_RE)) {
    const text = match[1];
    const slashIdx = text.indexOf('/');
    references.push(
      slashIdx === -1
        ? { text, path: text }
        : {
            text,
            path: text.slice(0, slashIdx),
            opacity: text.slice(slashIdx + 1),
          }
    );
  }
  return references;
}

export interface ResolvedReferences {
  /**
   * Emitted paths keep their `var()` indirection, every other path its
   * resolved literal; keys are in sorted path order for stable output.
   */
  tokenMap: Record<string, string>;
  /**
   * Declaration values for the emitted paths, in sorted token-path order —
   * the CSS emitter writes in iteration order, so builds are byte-identical.
   */
  variables: Record<string, string>;
}

/**
 * An unresolvable reference warns and keeps its literal: a kit theme may
 * reference tokens its consumer supplies later.
 */
export function resolveReferences(
  tokenMap: Record<string, string>,
  variableMap: Record<string, string>,
  variables: Record<string, string>
): ResolvedReferences {
  // The sorted path list drives traversal and output assembly, so neither
  // resolution nor key order can observe declaration order.
  const paths = Object.keys(tokenMap).sort();
  const known = new Set(paths);

  const rawValueOf = (path: string): string => {
    const varName = variableMap[path];
    if (varName !== undefined && variables[varName] !== undefined) {
      return variables[varName];
    }
    return tokenMap[path];
  };

  const referencesByPath = new Map<string, ParsedReference[]>();
  for (const path of paths) {
    const raw = rawValueOf(path);
    if (typeof raw === 'string' && raw.includes('{')) {
      const references = parseReferences(raw);
      if (references.length > 0) referencesByPath.set(path, references);
    }
  }

  const state = new Map<string, number>();
  const resolved = new Map<string, string>();
  const trail: string[] = [];
  const warnedMissing = new Set<string>();

  const substitute = (reference: ParsedReference, match: string): string => {
    if (!known.has(reference.path)) {
      if (!warnedMissing.has(reference.path)) {
        warnedMissing.add(reference.path);
        // oxlint-disable-next-line no-console -- intentional runtime diagnostic
        console.warn(
          `[animus] Token ref {${reference.text}} — path '${reference.path}' not found in token map`
        );
      }
      return match;
    }
    const targetVar = variableMap[reference.path];
    const targetValue = resolved.get(reference.path)!;
    const base =
      targetVar !== undefined && !targetValue.includes('{')
        ? `var(${targetVar})`
        : // Unresolvedness propagates through emitted targets: a declaration
          // must never survive pointing at a variable that was never written.
          targetValue;
    if (reference.opacity !== undefined) {
      const alpha = Number.parseInt(reference.opacity, 10);
      // Empty or non-numeric modifiers ('{path/}', '{path/abc}') degrade to
      // the unmodified base — never a NaN% color-mix.
      if (Number.isNaN(alpha)) return base;
      if (alpha === 0) return 'transparent';
      if (alpha !== 100) {
        return `color-mix(in srgb, ${base} ${alpha}%, transparent)`;
      }
    }
    return base;
  };

  const resolvePath = (path: string): void => {
    const status = state.get(path) ?? UNVISITED;
    if (status === RESOLVED) return;
    if (status === RESOLVING) {
      const cycle = [...trail.slice(trail.indexOf(path)), path];
      throw new Error(
        `build: token reference cycle — ${cycle
          .map((cyclePath) => `'${cyclePath}'`)
          .join(
            ' → '
          )}. Reference cycles cannot be resolved; give one of these tokens a literal value.`
      );
    }
    state.set(path, RESOLVING);
    trail.push(path);
    const references = referencesByPath.get(path);
    if (references) {
      // Emitted targets are traversed too: their literal goes unused, but
      // they must join cycle detection so emission flags cannot hide a cycle.
      for (const reference of references) {
        if (known.has(reference.path)) resolvePath(reference.path);
      }
    }
    let value = rawValueOf(path);
    if (references) {
      let index = 0;
      value = value.replace(TOKEN_REF_RE, (match) =>
        substitute(references[index++], match)
      );
    }
    trail.pop();
    state.set(path, RESOLVED);
    resolved.set(path, value);
  };

  for (const path of paths) resolvePath(path);

  const outTokenMap: Record<string, string> = {};
  const outVariables: Record<string, string> = {};
  for (const path of paths) {
    const varName = variableMap[path];
    if (varName === undefined) {
      outTokenMap[path] = resolved.get(path)!;
    } else {
      outTokenMap[path] = tokenMap[path];
      if (variables[varName] !== undefined) {
        outVariables[varName] = resolved.get(path)!;
      }
    }
  }
  for (const varName of Object.keys(variables).sort()) {
    if (outVariables[varName] === undefined) {
      outVariables[varName] = variables[varName];
    }
  }

  return { tokenMap: outTokenMap, variables: outVariables };
}
