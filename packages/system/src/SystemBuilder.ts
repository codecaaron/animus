import { Animus } from './Animus';
import {
  BUILT_IN_CONDITIONS,
  type ConditionAliasMap,
  mergeConditions,
  type RegistryBrand,
  serializeConditionMap,
} from './conditions';
import {
  type KeyframeFrameMap,
  type Keyframes,
  keyframes as keyframesImpl,
} from './keyframes';
import {
  BUILT_IN_SELECTORS,
  mergeSelectors,
  type SelectorAliasMap,
  serializeSelectorMap,
} from './selectors';
import { NamedTransform } from './transforms/createTransform';
import { Prop, ThemedCSSProps } from './types/config';
import { AbstractProps } from './types/props';

interface SerializedPropEntry {
  property: string;
  properties?: string[];
  scale?: string | Record<string, string | number> | (string | number)[];
  transform?: string;
  currentVar?: string;
  negative?: boolean;
}

export type GlobalStyleMap = Record<string, Record<string, any>>;

/** One `src` descriptor of a font-face resource. */
export interface FontFaceSrc {
  /**
   * Emitted byte-exact as authored — asset resolution and rewriting belong
   * to the host bundler's CSS asset pipeline, not to extraction.
   */
  url: string;
  /** Format hint (`woff2`, `woff`, …), rendered as `format('…')`. */
  format?: string;
}

/**
 * A typed `@font-face` descriptor (global-styles-system). `family` may use a
 * font-scale token reference (`{fonts.body}`); other descriptors take CSS
 * literals only.
 */
export interface FontFace {
  family: string;
  src: FontFaceSrc[];
  weight?: string;
  style?: string;
  display?: string;
  unicodeRange?: string;
  stretch?: string;
}

export interface GlobalStyleBlock {
  __brand: 'GlobalStyleBlock';
  styles: GlobalStyleMap;
  /** Rendered ahead of the block's selector rules in `@layer anm-global`. */
  fontFaces?: FontFace[];
}

export type GlobalStylesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Map extends Record<string, AbstractProps>>(
  styles: {
    readonly [K in keyof Map]: ThemedCSSProps<Map[K], PropReg>;
  },
  options?: { fontFaces?: readonly FontFace[] }
) => GlobalStyleBlock;

export type CreateKeyframesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Frames extends Record<string, Record<string, AbstractProps>>>(frames: {
  readonly [N in keyof Frames]: {
    readonly [S in keyof Frames[N]]: ThemedCSSProps<Frames[N][S], PropReg>;
  };
}) => Keyframes<{
  readonly [N in keyof Frames]: KeyframeFrameMap;
}>;

type IncludableSystem = { toConfig(): SerializedConfig };

/**
 * A library bundle groups one export for both builders: the system half is
 * consumed by `createSystem().from()`, the tokens half by
 * `createTheme().from()`; each builder takes its half and ignores the rest.
 */
export interface LibraryBundle {
  system: IncludableSystem;
  tokens?: unknown;
}

export interface CreateSystemConfig {
  /**
   * @deprecated Use `createSystem().from(source)` — the single inheritance
   * verb on both builders. The alias keeps identical discovery and runtime
   * semantics (it feeds the same source list `from()` appends to) but does
   * not provide `from()`'s type-surface admission.
   */
  includes?: readonly IncludableSystem[];
}

declare const STAGE_BRAND: unique symbol;

/**
 * Builder type-state for the inherit-first rule: `from()` is only callable
 * while the builder is in the `'inherit'` stage; every extension call
 * (`addGroup`, `addProps`, `addSelectors`, `addConditions`) advances to
 * `'extend'`, making "inherit first, then extend" a compile error rather
 * than a lint. Phantom — never present at runtime.
 */
export type SystemBuilderStage = 'inherit' | 'extend';

function orderedPropertiesEqual(
  existing: Prop['properties'],
  incoming: Prop['properties']
): boolean {
  if (existing === incoming) {
    return true;
  }

  if (!existing || !incoming || existing.length !== incoming.length) {
    return false;
  }

  return existing.every((property, index) => property === incoming[index]);
}

function arePropDefinitionsEqual(existing: Prop, incoming: Prop): boolean {
  return (
    existing.property === incoming.property &&
    orderedPropertiesEqual(existing.properties, incoming.properties) &&
    existing.scale === incoming.scale &&
    existing.variable === incoming.variable &&
    existing.negative === incoming.negative &&
    existing.strict === incoming.strict &&
    existing.currentVar === incoming.currentVar &&
    existing.transform === incoming.transform
  );
}

export class SystemBuilder<
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
  Conds extends string = never,
  Sels extends string = never,
  Stage extends SystemBuilderStage = 'inherit',
> {
  // Structural anchor for the phantom Stage parameter — without a member
  // referencing it, 'inherit' and 'extend' builders would be mutually
  // assignable and the `this`-typed `from()` gate would never fire.
  declare readonly [STAGE_BRAND]?: Stage;

  #propRegistry: PropReg;
  #groupRegistry: GroupReg;
  #selectorRegistry: SelectorAliasMap;
  #includesRegistry: readonly IncludableSystem[];
  #conditionRegistry: ConditionAliasMap;

  constructor(
    propRegistry?: PropReg,
    groupRegistry?: GroupReg,
    selectorRegistry?: SelectorAliasMap,
    includesRegistry?: readonly IncludableSystem[],
    conditionRegistry?: ConditionAliasMap
  ) {
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
    this.#selectorRegistry = selectorRegistry || { ...BUILT_IN_SELECTORS };
    this.#includesRegistry = includesRegistry || [];
    this.#conditionRegistry = conditionRegistry || { ...BUILT_IN_CONDITIONS };
  }

  /**
   * Declare inheritance from a consumed library: the source's TYPE surface is
   * admitted (prop/component types for compose/extend interop) and the source
   * joins extraction discovery membership. NO registry merge — consumer
   * configuration remains the singular authority, so props, groups,
   * selectors, and conditions the source registered do not enter this
   * builder's runtime registries. Chainable and repeatable, but only before
   * extension calls ("inherit first, then extend" — enforced by the phantom
   * builder stage). Accepts a built system instance or a library bundle
   * (`{ system, tokens }`), taking the system half and ignoring the rest.
   */
  from<
    SrcProps extends Record<string, Prop>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source:
      | SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>
      | {
          system: SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit'
  > {
    // Bundle detection keys on `system.toConfig` being callable — a built
    // system instance also has a `.system()` CHAIN METHOD, so presence of a
    // `system` key alone cannot discriminate the two shapes.
    const maybeBundle = source as { system?: { toConfig?: unknown } };
    const instance =
      maybeBundle.system && typeof maybeBundle.system.toConfig === 'function'
        ? (maybeBundle.system as IncludableSystem)
        : (source as IncludableSystem);
    return new SystemBuilder<
      PropReg & SrcProps,
      GroupReg & SrcGroups,
      Conds | SrcConds,
      Sels | SrcSels,
      'inherit'
    >(
      this.#propRegistry as PropReg & SrcProps,
      this.#groupRegistry as GroupReg & SrcGroups,
      this.#selectorRegistry,
      [...this.#includesRegistry, instance],
      this.#conditionRegistry
    );
  }

  addSelectors<S extends Record<`_${string}`, string>>(
    selectors: S
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds,
    Sels | Extract<keyof S, string>,
    'extend'
  > {
    // Cross-registry clash guard, REVERSE direction (inc-11 full-pass F-1.4):
    // a name already registered as a CONDITION alias must not be re-registered
    // as a selector — Rust dispatch prefers selector aliases, so the condition
    // would silently never resolve. addConditions guards the other direction.
    for (const name of Object.keys(selectors)) {
      if (name in this.#conditionRegistry) {
        throw new Error(
          `addSelectors: "${name}" is already registered as a condition alias; ` +
            'a name resolves through exactly one registry. Pick a distinct name.'
        );
      }
    }
    const merged = mergeSelectors(this.#selectorRegistry, selectors);
    // Conds/Sels/Stage are phantom type-state (no runtime constructor slot);
    // the accumulated union and the 'extend' stage advance are applied via
    // explicit constructor type arguments.
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds,
      Sels | Extract<keyof S, string>,
      'extend'
    >(
      this.#propRegistry,
      this.#groupRegistry,
      merged,
      this.#includesRegistry,
      this.#conditionRegistry
    );
  }

  /**
   * Register condition aliases (`_motionReduce`, `_cardSm`, …) → at-rule
   * condition strings (`@media …` / `@container …` / `@supports …`).
   * Recognized as block keys in style objects; user aliases override built-ins
   * of the same name (design D3). Keys are constrained to `_`-prefixed aliases
   * and values to `@`-prefixed at-rule strings — a value that does not begin
   * with an at-rule name is a compile-time type error (design D9; the runtime
   * `inferConditionKind` throw is defense-in-depth). The registered keys are
   * accumulated into the phantom `Conds` union and surfaced on `build()`.
   */
  addConditions<
    C extends Record<
      `_${string}`,
      `@media${string}` | `@container${string}` | `@supports${string}`
    >,
  >(
    conditions: C
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds | Extract<keyof C, string>,
    Sels,
    'extend'
  > {
    const merged = mergeConditions(
      this.#conditionRegistry,
      conditions,
      new Set(Object.keys(this.#selectorRegistry))
    );
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds | Extract<keyof C, string>,
      Sels,
      'extend'
    >(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      merged
    );
  }

  addGroup<Name extends string, Conf extends Record<string, Prop>>(
    name: Name extends keyof PropReg ? never : Name,
    config: Conf
  ): SystemBuilder<
    PropReg & Conf,
    GroupReg & Record<Name, (keyof Conf)[]>,
    Conds,
    Sels,
    'extend'
  > {
    // Collision check: group name must not collide with any registered prop name
    if (name in this.#propRegistry) {
      throw new Error(
        `Group name "${name}" collides with an existing prop name. ` +
          `Group names and prop names must be disjoint.`
      );
    }

    // Overlap tolerance: check existing props for definition match
    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
        const incoming = config[key];
        if (!arePropDefinitionsEqual(existing, incoming)) {
          throw new Error(
            `Prop "${key}" already registered with a different definition. ` +
              `Existing: property="${existing.property}", scale="${String(existing.scale)}". ` +
              `Incoming: property="${incoming.property}", scale="${String(incoming.scale)}".`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    const newGroup = {
      [name]: Object.keys(config),
    } as Record<Name, (keyof Conf)[]>;
    const nextGroups = { ...this.#groupRegistry, ...newGroup };

    return new SystemBuilder<
      PropReg & Conf,
      GroupReg & Record<Name, (keyof Conf)[]>,
      Conds,
      Sels,
      'extend'
    >(
      nextProps,
      nextGroups,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry
    );
  }

  addProps<
    Conf extends Record<string, Prop> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(
    config: Conf
  ): SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend'> {
    // Collision check: prop names must not collide with any registered group name
    for (const key of Object.keys(config)) {
      if (key in this.#groupRegistry) {
        throw new Error(
          `Prop name "${key}" collides with an existing group name. ` +
            `Group names and prop names must be disjoint.`
        );
      }
    }

    // Overlap tolerance: same check as addGroup
    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
        const incoming = (config as Record<string, Prop>)[key];
        if (!arePropDefinitionsEqual(existing, incoming)) {
          throw new Error(
            `Prop "${key}" already registered with a different definition.`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    return new SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend'>(
      nextProps,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry
    );
  }

  build(): {
    system: SystemInstance<PropReg, GroupReg, Conds, Sels>;
    createGlobalStyles: GlobalStylesFactory<PropReg>;
    createKeyframes: CreateKeyframesFactory<PropReg>;
  } {
    const animus = new Animus<PropReg, GroupReg>(
      this.#propRegistry,
      this.#groupRegistry
    );

    const propRegistry = this.#propRegistry;
    const groupRegistry = this.#groupRegistry;
    const selectorRegistry = this.#selectorRegistry;
    const conditionRegistry = this.#conditionRegistry;

    const system = Object.assign(animus, {
      toConfig: (): SerializedConfig => {
        return serializeInstance(
          propRegistry,
          groupRegistry,
          selectorRegistry,
          conditionRegistry
        );
      },
    }) as SystemInstance<PropReg, GroupReg, Conds, Sels>;

    const createGlobalStyles = ((
      styles: GlobalStyleMap,
      options?: { fontFaces?: readonly FontFace[] }
    ): GlobalStyleBlock => ({
      __brand: 'GlobalStyleBlock' as const,
      styles,
      ...(options?.fontFaces?.length
        ? { fontFaces: [...options.fontFaces] }
        : {}),
    })) as GlobalStylesFactory<PropReg>;

    const createKeyframes = ((frames: Record<string, KeyframeFrameMap>) =>
      keyframesImpl(frames)) as CreateKeyframesFactory<PropReg>;

    return { system, createGlobalStyles, createKeyframes };
  }
}

export type SystemInstance<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
> = Animus<PropReg, GroupReg> & {
  toConfig(): SerializedConfig;
} & RegistryBrand<Conds, Sels>;

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  selectorAliases: string;
  /**
   * Condition alias map JSON (inc 03 — NEW field): `alias → { value, order,
   * kind }`. `"{}"` when the system registers no conditions (built-ins are
   * empty this increment). Distinct from `selectorAliases`, which stays
   * byte-for-byte unchanged.
   */
  conditionAliases: string;
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
>(
  propRegistry: PropReg,
  groupRegistry: GroupReg,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): SerializedConfig {
  const serialized: Record<string, SerializedPropEntry> = {};
  const transforms: Record<string, NamedTransform> = {};

  for (const [propName, entry] of Object.entries(propRegistry)) {
    const s: SerializedPropEntry = { property: (entry as any).property };

    if ((entry as any).properties && (entry as any).properties.length > 0) {
      s.properties = [...(entry as any).properties];
    }

    const scale = (entry as any).scale;
    if (typeof scale === 'string') {
      s.scale = scale;
    } else if (scale && typeof scale === 'object') {
      s.scale = scale;
    }

    if ((entry as any).negative) {
      s.negative = true;
    }

    if ((entry as any).transform) {
      const fn = (entry as any).transform;
      const name = fn.transformName ?? fn.name;
      if (name) {
        s.transform = name;
        transforms[name] = fn;
      }
    }

    if ((entry as any).currentVar) {
      s.currentVar = (entry as any).currentVar;
    }

    serialized[propName] = s;
  }

  const { selectors } = serializeSelectorMap(selectorRegistry);
  const conditions = serializeConditionMap(conditionRegistry);

  return {
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
    selectorAliases: JSON.stringify(selectors),
    conditionAliases: JSON.stringify(conditions),
  };
}

export function createSystem(config?: CreateSystemConfig): SystemBuilder {
  return new SystemBuilder(
    undefined,
    undefined,
    undefined,
    config?.includes ?? []
  );
}
