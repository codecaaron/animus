/**
 * Hypothetical worlds as a *view*, never a patch.
 *
 * `WorldDelta`s describe edits the oracle evaluates without touching source
 * (DESIGN §2). This module turns a delta list into a read-only style universe
 * and token provider that the cascade reads exactly as it reads the host's own
 * — so `simulate` and `diff` are the same engine over a different view, and
 * nothing in the substrate can write a speculation back.
 *
 * A delta naming a rule or property that does not exist is a *bad request*, not
 * a verdict: it throws `TypeError` rather than quietly evaluating to "no
 * change", which would let an agent believe it had tested something it had not.
 */

import { ROOT_MODE } from '../providers/tokens';

import type { RuleId } from '../core/identity';
import type { WorldDelta } from '../core/world';
import type { OracleHost } from '../providers/host';
import type {
  DeclarationRecord,
  StyleRuleRecord,
  StyleUniverse,
} from '../providers/style-universe';
import type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from '../providers/tokens';

export interface SpeculationView {
  universe: StyleUniverse;
  tokens: TokenProvider | undefined;
  /** `assume` deltas, verbatim — they are stated, never checked. */
  assumptions: readonly string[];
  affectedRules: readonly RuleId[];
  affectedProperties: readonly string[];
  affectedTokens: readonly string[];
}

const IMPORTANT_SUFFIX = /\s*!important\s*$/;

interface ParsedValue {
  value: string;
  important: boolean;
}

const parseValue = (raw: string): ParsedValue =>
  IMPORTANT_SUFFIX.test(raw)
    ? { value: raw.replace(IMPORTANT_SUFFIX, ''), important: true }
    : { value: raw, important: false };

/**
 * Build the hypothetical declaration for `raw`, carrying `!important` from an
 * inherited source declaration when one is given. The authored spelling is
 * never carried over — it belongs to the source declaration, and keeping it
 * would attribute a value nobody wrote.
 */
const declarationFrom = (
  property: string,
  raw: string,
  inherited?: DeclarationRecord
): DeclarationRecord => {
  const parsed = parseValue(raw);
  const next: DeclarationRecord = { property, value: parsed.value };
  if (parsed.important || inherited?.important === true) next.important = true;
  return next;
};

/** Is `--x` the whole of `raw`, i.e. `var(--x)` or `var(--x, fallback)`? */
const soleReference = (raw: string): string | undefined => {
  const match = /^\s*var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[\s\S]*)?\)\s*$/.exec(
    raw
  );
  return match === null ? undefined : match[1];
};

/**
 * A token provider with some variables overridden.
 *
 * Resolution walks the reference chain itself so an override *inside* a chain
 * is honoured, and delegates to the base provider whenever the walked chain
 * touches no override — that keeps a host's richer resolution semantics
 * intact for every variable the speculation does not touch.
 */
const overlayTokens = (
  base: TokenProvider,
  overrides: ReadonlyMap<string, string>
): TokenProvider => {
  const definitionOf = (variable: string): TokenDefinition | undefined => {
    const override = overrides.get(variable);
    if (override === undefined) return base.token(variable);

    const valuesByMode: Record<string, string> = {};
    valuesByMode[ROOT_MODE] = override;
    for (const mode of base.modes()) valuesByMode[mode] = override;
    return { variable, valuesByMode, references: [] };
  };

  const walk = (
    variable: string,
    mode: string
  ): { resolution: TokenResolution; touched: boolean } | undefined => {
    const chain: string[] = [];
    let current = variable;
    let touched = false;

    for (let depth = 0; depth <= 32; depth += 1) {
      chain.push(current);
      const override = overrides.get(current);
      if (override !== undefined) {
        return { resolution: { value: override, chain }, touched: true };
      }

      const definition = base.token(current);
      if (definition === undefined) return undefined;
      // The same fallback the providers use: a link declared only in `:root`
      // (the usual home of aliases) must not break the walk.
      const raw =
        definition.valuesByMode[mode] ?? definition.valuesByMode[ROOT_MODE];
      if (raw === undefined) return undefined;

      const next = soleReference(raw);
      if (next === undefined) {
        return { resolution: { value: raw, chain }, touched };
      }
      current = next;
    }

    return undefined;
  };

  return {
    modes: () => base.modes(),
    defaultMode: () => base.defaultMode(),
    token: definitionOf,
    all: () =>
      base
        .all()
        .map((definition) => definitionOf(definition.variable) ?? definition),
    resolve: (variable, mode) => {
      const walked = walk(variable, mode);
      if (walked === undefined) return base.resolve(variable, mode);
      if (!walked.touched) return base.resolve(variable, mode);
      return walked.resolution;
    },
  };
};

interface RuleEdits {
  removed: Set<string>;
  replaced: Map<string, string>;
  added: DeclarationRecord[];
}

const editsFor = (edits: Map<RuleId, RuleEdits>, rule: RuleId): RuleEdits => {
  const existing = edits.get(rule);
  if (existing !== undefined) return existing;
  const created: RuleEdits = {
    removed: new Set(),
    replaced: new Map(),
    added: [],
  };
  edits.set(rule, created);
  return created;
};

const requireRule = (
  universe: StyleUniverse,
  rule: RuleId,
  kind: string
): StyleRuleRecord => {
  const found = universe.ruleById(rule);
  if (found === undefined) {
    throw new TypeError(
      `${kind}: no rule '${rule}' in the modeled universe — a delta that ` +
        'names nothing cannot be evaluated, and answering "no change" would ' +
        'report a test that never ran'
    );
  }
  return found;
};

const requireDeclaration = (
  rule: StyleRuleRecord,
  property: string,
  kind: string
): void => {
  if (
    rule.declarations.some((declaration) => declaration.property === property)
  ) {
    return;
  }
  throw new TypeError(
    `${kind}: rule '${rule.id}' declares no '${property}' (it declares ` +
      `${rule.declarations.map((d) => d.property).join(', ') || 'nothing'})`
  );
};

export const speculate = (
  host: OracleHost,
  deltas: readonly WorldDelta[]
): SpeculationView => {
  const base = host.universe.universe();
  const edits = new Map<RuleId, RuleEdits>();
  const tokenOverrides = new Map<string, string>();
  const assumptions: string[] = [];
  const affectedProperties = new Set<string>();

  for (const delta of deltas) {
    switch (delta.kind) {
      case 'remove-declaration': {
        const rule = requireRule(base, delta.rule, 'remove-declaration');
        requireDeclaration(rule, delta.property, 'remove-declaration');
        editsFor(edits, delta.rule).removed.add(delta.property);
        affectedProperties.add(delta.property);
        break;
      }
      case 'replace-declaration': {
        const rule = requireRule(base, delta.rule, 'replace-declaration');
        requireDeclaration(rule, delta.property, 'replace-declaration');
        editsFor(edits, delta.rule).replaced.set(delta.property, delta.value);
        affectedProperties.add(delta.property);
        break;
      }
      case 'add-declaration': {
        requireRule(base, delta.rule, 'add-declaration');
        editsFor(edits, delta.rule).added.push(
          declarationFrom(delta.property, delta.value)
        );
        affectedProperties.add(delta.property);
        break;
      }
      case 'replace-token': {
        if (host.tokens === undefined) {
          throw new TypeError(
            `replace-token: this host declares no token provider, so ` +
              `'${delta.token}' names nothing that can be replaced`
          );
        }
        if (host.tokens.token(delta.token) === undefined) {
          throw new TypeError(
            `replace-token: '${delta.token}' is not a modeled custom ` +
              'property — replacing an unmodeled variable would state a ' +
              'change the cascade cannot see'
          );
        }
        tokenOverrides.set(delta.token, delta.value);
        break;
      }
      case 'assume':
        assumptions.push(
          delta.note === undefined
            ? delta.assumption
            : `${delta.assumption} (${delta.note})`
        );
        break;
      case 'force-dimension':
      case 'pin-dimension-domain':
        // Scenario-level deltas: `applyDeltas` has already narrowed the
        // world's domain, and the universe is unchanged by them.
        break;
    }
  }

  const editedUniverse = (): StyleUniverse => {
    const rules = base.rules.map((rule) => {
      const edit = edits.get(rule.id);
      if (edit === undefined) return rule;

      const declarations = rule.declarations
        .filter((declaration) => !edit.removed.has(declaration.property))
        .map((declaration) => {
          const replacement = edit.replaced.get(declaration.property);
          return replacement === undefined
            ? declaration
            : declarationFrom(declaration.property, replacement, declaration);
        });

      return {
        ...rule,
        declarations: [...declarations, ...edit.added],
      };
    });
    const rulesById = new Map<string, StyleRuleRecord>(
      rules.map((rule) => [rule.id, rule])
    );
    return {
      rules,
      ruleById: (id: RuleId) => rulesById.get(id),
      layerOrder: base.layerOrder,
      exclusions: base.exclusions,
    };
  };

  const universe = edits.size === 0 ? base : editedUniverse();

  return {
    universe,
    tokens:
      tokenOverrides.size === 0 || host.tokens === undefined
        ? host.tokens
        : overlayTokens(host.tokens, tokenOverrides),
    assumptions,
    affectedRules: Array.from(edits.keys()).sort(),
    affectedProperties: Array.from(affectedProperties).sort(),
    affectedTokens: Array.from(tokenOverrides.keys()).sort(),
  };
};
