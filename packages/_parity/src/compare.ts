/**
 * Per-artifact-class comparison (design intent: CSS by bytes with parsed-CSS
 * classification; transformed code by normalized AST equivalence; manifest
 * by derived observables; diagnostics as multisets).
 */
import { hashArtifact } from './content-hash';

import type {
  ArtifactClass,
  CssClassification,
  Divergence,
  UnitSurface,
} from './types';

/** Parse CSS; returns error string or null. Uses lightningcss. */
export async function cssParseError(css: string): Promise<string | null> {
  if (!css.trim()) return null;
  try {
    const { transform } = await import('lightningcss');
    transform({
      filename: 'parity.css',
      code: new TextEncoder().encode(css),
      minify: false,
      errorRecovery: false,
    });
    return null;
  } catch (e) {
    return String(e);
  }
}

/** Canonical form for formatting-insensitivity: lightningcss minified. */
async function canonicalCss(css: string): Promise<string> {
  const { transform } = await import('lightningcss');
  const res = transform({
    filename: 'parity.css',
    code: new TextEncoder().encode(css),
    minify: true,
    errorRecovery: true,
  });
  return new TextDecoder().decode(res.code);
}

/** Split CSS into sibling rule strings at one nesting level (brace scanner).
 *  Statement at-rules (`@layer a,b;`, `@import ...;`) end at a depth-0
 *  semicolon before any brace — without this they glue to the next rule. */
function siblingRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let sawBrace = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      depth++;
      sawBrace = true;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1).trim());
        start = i + 1;
        sawBrace = false;
      }
    } else if (ch === ';' && depth === 0 && !sawBrace) {
      rules.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const tail = css.slice(start).trim();
  if (tail) rules.push(tail);
  return rules;
}

/** Flatten rules recursively: block at-rules (@layer/@media/@supports) are
 *  descended into, each inner rule prefixed with its at-rule header — so a
 *  reorder INSIDE a layer still classifies as rule-order for component CSS
 *  nested inside @layer blocks. */
function flattenRules(css: string): string[] {
  const out: string[] = [];
  for (const rule of siblingRules(css)) {
    const brace = rule.indexOf('{');
    const header = brace >= 0 ? rule.slice(0, brace).trim() : rule.trim();
    if (
      /^@(layer|media|supports)\b/.test(header) &&
      brace >= 0 &&
      rule.endsWith('}')
    ) {
      const inner = rule.slice(brace + 1, -1);
      for (const child of flattenRules(inner))
        out.push(`${header} :: ${child}`);
    } else {
      out.push(rule);
    }
  }
  return out;
}

function selectorOf(rule: string): string {
  const brace = rule.indexOf('{');
  return brace >= 0 ? rule.slice(0, brace).trim() : rule.trim();
}

export async function classifyCssDivergence(
  a: string,
  b: string
): Promise<CssClassification> {
  const [ca, cb] = [await canonicalCss(a), await canonicalCss(b)];
  if (ca === cb) return 'formatting';
  const [ra, rb] = [flattenRules(ca), flattenRules(cb)];
  const setEq =
    ra.length === rb.length &&
    [...ra].sort().join(' ') === [...rb].sort().join(' ');
  if (setEq) return 'rule-order';
  const [sa, sb] = [ra.map(selectorOf).sort(), rb.map(selectorOf).sort()];
  if (sa.join(' ') === sb.join(' ')) return 'value';
  return 'selector';
}

/** Strip location fields and sort object-literal properties by key so the
 *  comparison is key-order-insensitive for embedded config literals. */
function normalizeAst(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeAst);
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      // raw carries quote style / literal spelling; value is the semantic field
      if (
        k === 'start' ||
        k === 'end' ||
        k === 'range' ||
        k === 'loc' ||
        k === 'raw'
      )
        continue;
      out[k] = normalizeAst(o[k]);
    }
    if (out.type === 'ObjectExpression' && Array.isArray(out.properties)) {
      // Key-order insensitivity is licensed ONLY for plain record literals:
      // no spreads, no computed keys, no duplicate keys — those make order
      // semantically load-bearing (spread/last-wins override order).
      const props = out.properties as Array<Record<string, unknown>>;
      const keys = props.map((p) => {
        if (p.type !== 'Property' || p.computed) return null;
        const k = p.key as Record<string, unknown> | undefined;
        return k?.type === 'Identifier'
          ? `i:${k.name}`
          : k?.type === 'Literal'
            ? `l:${k.value}`
            : null;
      });
      const sortable =
        keys.every((k) => k !== null) && new Set(keys).size === keys.length;
      if (sortable) {
        out.properties = props
          .map((p) => JSON.stringify(p))
          .sort()
          .map((s) => JSON.parse(s));
      }
    }
    return out;
  }
  return node;
}

export async function codeAstEquivalent(
  a: string,
  b: string,
  path: string
): Promise<boolean> {
  if (a === b) return true;
  const { parseSync } = await import('oxc-parser');
  const fname =
    path.endsWith('.tsx') || path.endsWith('.ts') ? path : `${path}.tsx`;
  const pa = parseSync(fname, a);
  const pb = parseSync(fname, b);
  if (pa.errors.length || pb.errors.length) return false;
  return (
    JSON.stringify(normalizeAst(pa.program)) ===
    JSON.stringify(normalizeAst(pb.program))
  );
}

/** Compare two engine surfaces for one unit. Returns divergences (empty =
 *  identical on the declared surface). */
export async function compareUnit(
  unit: string,
  a: UnitSurface,
  b: UnitSurface
): Promise<Divergence[]> {
  const out: Divergence[] = [];
  const divergence = (
    artifact: ArtifactClass,
    detail: string,
    classification?: CssClassification
  ): Divergence => ({
    unit,
    artifact,
    detail,
    baselineSha256: hashArtifact(a, artifact),
    candidateSha256: hashArtifact(b, artifact),
    ...(classification ? { classification } : {}),
  });

  for (const [engineTag, s] of [
    ['a', a],
    ['b', b],
  ] as const) {
    const err = await cssParseError(s.css);
    if (err) {
      out.push(
        divergence(
          'css-validity',
          `engine ${engineTag}: CSS failed to parse: ${err.slice(0, 200)}`
        )
      );
    }
  }

  if (a.css !== b.css) {
    out.push(
      divergence(
        'css',
        `CSS bytes differ (${a.css.length} vs ${b.css.length})`,
        await classifyCssDivergence(a.css, b.css)
      )
    );
  }

  const codePaths = new Set([...Object.keys(a.code), ...Object.keys(b.code)]);
  for (const p of codePaths) {
    const [ca, cb] = [a.code[p], b.code[p]];
    if (ca === undefined || cb === undefined) {
      out.push(divergence('code', `${p}: present in one engine only`));
      continue;
    }
    if (!(await codeAstEquivalent(ca, cb, p))) {
      out.push(divergence('code', `${p}: transformed code not AST-equivalent`));
    }
  }

  const componentPaths = new Set([
    ...Object.keys(a.hasComponents),
    ...Object.keys(b.hasComponents),
  ]);
  for (const p of componentPaths) {
    if (a.hasComponents[p] !== b.hasComponents[p]) {
      out.push(divergence('code', `${p}: hasComponents differs`));
    }
  }

  const obsA = a.observables;
  const obsB = b.observables;
  const obsChecks: Array<[string, string, string]> = [
    ['parseCount', String(a.parseCount), String(b.parseCount)],
    [
      'componentFragmentKeys',
      JSON.stringify(obsA.componentFragmentKeys),
      JSON.stringify(obsB.componentFragmentKeys),
    ],
    [
      'reverseProvenanceEdges',
      JSON.stringify(obsA.reverseProvenanceEdges),
      JSON.stringify(obsB.reverseProvenanceEdges),
    ],
    ['systemPropMapJson', obsA.systemPropMapJson, obsB.systemPropMapJson],
    ['dynamicPropsJson', obsA.dynamicPropsJson, obsB.dynamicPropsJson],
    ['sheetsJson', obsA.sheetsJson, obsB.sheetsJson],
    [
      'componentFragmentsJson',
      obsA.componentFragmentsJson,
      obsB.componentFragmentsJson,
    ],
  ];
  for (const [name, va, vb] of obsChecks) {
    if (va !== vb) {
      out.push(divergence('observables', `${name} differs`));
    }
  }

  if (JSON.stringify(a.diagnostics) !== JSON.stringify(b.diagnostics)) {
    out.push(
      divergence(
        'diagnostics',
        `diagnostics multiset differs (${a.diagnostics.length} vs ${b.diagnostics.length})`
      )
    );
  }

  return out;
}
