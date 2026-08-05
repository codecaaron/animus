/**
 * Late-binding token-reference resolution over the flattened theme (D4,
 * openspec change first-class-extension).
 *
 * Replaces the old single-pass, insertion-order-dependent rewrite: references
 * resolve against the COMPLETE flattened map via depth-first traversal of the
 * reference DAG, so declaration order is never observable (G3), references
 * inside emitted scales resolve into the emitted variable declarations
 * instead of leaking literally into CSS (G2), and a token resolves to the
 * same value whether its scale is emitted or inlined (G1 — an emitted target
 * substitutes as `var()`, which the cascade late-binds to exactly the value
 * the inlined form substitutes directly).
 *
 * Pure module: consumes the flatten pass's maps, returns fresh maps, mutates
 * nothing. Runs in QuickJS — ES built-ins only, no Node/WHATWG APIs.
 */

/** Token ref pattern: {scale.key}, {scale.key.sub}, or {path/NN} (opacity). */
const TOKEN_REF_RE = /\{([^}]+)\}/g;

/** One parsed `{...}` occurrence of a token value, in source order. */
interface ParsedReference {
  /** Full inner text including any opacity suffix — for diagnostics. */
  text: string;
  /** Referenced token path (opacity suffix stripped). */
  path: string;
  /** Opacity modifier digits when the `{path/NN}` form was authored. */
  opacity?: string;
}

/** DFS node states for cycle detection. */
const UNVISITED = 0;
const RESOLVING = 1;
const RESOLVED = 2;

/** Parse every `{...}` occurrence via matchAll — no shared lastIndex. */
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
   * Token path → resolved value: emitted paths keep their `var()`
   * indirection; every other path carries its fully resolved literal.
   * Keys are in sorted token-path order (deterministic serialization).
   */
  tokenMap: Record<string, string>;
  /**
   * CSS var name → resolved declaration value for every emitted path, in
   * sorted token-path order — `buildVariableCss` emits in iteration order,
   * so reversed-declaration builds produce byte-identical CSS.
   */
  variables: Record<string, string>;
}

/**
 * Resolve token references over the complete flattened maps.
 *
 * - `tokenMap`/`variableMap`/`variables` are `flattenTheme`'s outputs: an
 *   emitted path's tokenMap entry is its `var()` indirection and its RAW
 *   authored value is parked in `variables`; a non-emitted path's tokenMap
 *   entry IS its raw value.
 * - Substitution per reference: emitted target → `var(--target)`; non-emitted
 *   target → its resolved literal; `{path/NN}` keeps the existing
 *   `color-mix` output shape (`/0` → `transparent`, `/100` → the base).
 * - Unresolvable target: warn once per missing path, keep the literal — a
 *   SUPPORTED pattern (a kit theme may reference tokens its consumer
 *   provides later). Dangling-reference errors arrive with the explicit
 *   replacement form (D5, increment 04).
 * - Reference cycle: hard error naming the cycle's token paths in traversal
 *   order, regardless of emission flags (emission-invariant failure, G1).
 */
export function resolveReferences(
  tokenMap: Record<string, string>,
  variableMap: Record<string, string>,
  variables: Record<string, string>
): ResolvedReferences {
  // Lexicographically sorted roots: the sorted path list drives traversal
  // AND output assembly, so neither resolution nor key order can observe
  // declaration/insertion order (G3).
  const paths = Object.keys(tokenMap).sort();
  const known = new Set(paths);

  /** The authored (raw) value behind a path — see the contract note above. */
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
  /** Active DFS trail — the cycle report slices it from the revisited node. */
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
        : // Non-emitted targets resolve depth-first before their referrers,
          // and unresolvedness must propagate through emitted targets so a
          // declaration never survives while pointing at an omitted var.
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
      // Dependencies resolve first — including emitted targets, which do not
      // need their literal but must still participate in cycle detection so
      // a cyclic theme fails identically under any emission flags.
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

  // ── Deterministic output assembly ─────────────────────────
  const outTokenMap: Record<string, string> = {};
  const outVariables: Record<string, string> = {};
  for (const path of paths) {
    const varName = variableMap[path];
    if (varName === undefined) {
      outTokenMap[path] = resolved.get(path)!;
    } else {
      // Emitted path: the tokenMap keeps the var() indirection; the resolved
      // literal becomes the variable DECLARATION value.
      outTokenMap[path] = tokenMap[path];
      if (variables[varName] !== undefined) {
        outVariables[varName] = resolved.get(path)!;
      }
    }
  }
  // Defensive pass-through for variables not owned by any token path (none
  // are produced today); appended AFTER the owned entries in sorted var-name
  // order, so even this dead path can never make insertion order observable
  // (G3 — inc 04 closure of the review-registered latent note).
  for (const varName of Object.keys(variables).sort()) {
    if (outVariables[varName] === undefined) {
      outVariables[varName] = variables[varName];
    }
  }

  return { tokenMap: outTokenMap, variables: outVariables };
}
