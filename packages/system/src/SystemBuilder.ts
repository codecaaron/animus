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

export interface GlobalStyleBlock {
  __brand: 'GlobalStyleBlock';
  styles: GlobalStyleMap;
}

export type GlobalStylesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Map extends Record<string, AbstractProps>>(styles: {
  readonly [K in keyof Map]: ThemedCSSProps<Map[K], PropReg>;
}) => GlobalStyleBlock;

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

export interface CreateSystemConfig {
  includes?: readonly IncludableSystem[];
}

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
> {
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

  addSelectors<S extends Record<`_${string}`, string>>(
    selectors: S
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels | Extract<keyof S, string>> {
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
    // Conds/Sels are phantom type-state (no runtime constructor slot); the
    // constructor infers them as `never`, so the accumulated union is applied
    // by this cast.
    return new SystemBuilder(
      this.#propRegistry,
      this.#groupRegistry,
      merged,
      this.#includesRegistry,
      this.#conditionRegistry
    ) as SystemBuilder<
      PropReg,
      GroupReg,
      Conds,
      Sels | Extract<keyof S, string>
    >;
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
  ): SystemBuilder<PropReg, GroupReg, Conds | Extract<keyof C, string>, Sels> {
    const merged = mergeConditions(
      this.#conditionRegistry,
      conditions,
      new Set(Object.keys(this.#selectorRegistry))
    );
    return new SystemBuilder(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      merged
    ) as SystemBuilder<
      PropReg,
      GroupReg,
      Conds | Extract<keyof C, string>,
      Sels
    >;
  }

  addGroup<Name extends string, Conf extends Record<string, Prop>>(
    name: Name extends keyof PropReg ? never : Name,
    config: Conf
  ): SystemBuilder<
    PropReg & Conf,
    GroupReg & Record<Name, (keyof Conf)[]>,
    Conds,
    Sels
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

    return new SystemBuilder(
      nextProps,
      nextGroups,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry
    ) as SystemBuilder<
      PropReg & Conf,
      GroupReg & Record<Name, (keyof Conf)[]>,
      Conds,
      Sels
    >;
  }

  addProps<
    Conf extends Record<string, Prop> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(config: Conf): SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels> {
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
    return new SystemBuilder(
      nextProps,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry
    ) as SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels>;
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

    const createGlobalStyles = ((styles: GlobalStyleMap): GlobalStyleBlock => ({
      __brand: 'GlobalStyleBlock' as const,
      styles,
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
