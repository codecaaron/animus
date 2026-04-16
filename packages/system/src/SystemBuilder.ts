import { Animus } from './Animus';
import {
  BUILT_IN_SELECTORS,
  mergeSelectors,
  type SelectorAliasMap,
  serializeSelectorMap,
} from './selectors';
import { NamedTransform } from './transforms/createTransform';
import { Prop } from './types/config';

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

export type GlobalStylesFactory = (styles: GlobalStyleMap) => GlobalStyleBlock;

type IncludableSystem = { toConfig(): SerializedConfig };

export interface CreateSystemConfig {
  includes?: readonly IncludableSystem[];
}

export class SystemBuilder<
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
> {
  #propRegistry: PropReg;
  #groupRegistry: GroupReg;
  #selectorRegistry: SelectorAliasMap;
  #includesRegistry: readonly IncludableSystem[];

  constructor(
    propRegistry?: PropReg,
    groupRegistry?: GroupReg,
    selectorRegistry?: SelectorAliasMap,
    includesRegistry?: readonly IncludableSystem[]
  ) {
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
    this.#selectorRegistry = selectorRegistry || { ...BUILT_IN_SELECTORS };
    this.#includesRegistry = includesRegistry || [];
  }

  addSelectors(
    selectors: Record<string, string>
  ): SystemBuilder<PropReg, GroupReg> {
    const merged = mergeSelectors(this.#selectorRegistry, selectors);
    return new SystemBuilder(
      this.#propRegistry,
      this.#groupRegistry,
      merged,
      this.#includesRegistry
    );
  }

  addGroup<Name extends string, Conf extends Record<string, Prop>>(
    name: Name extends keyof PropReg ? never : Name,
    config: Conf
  ): SystemBuilder<PropReg & Conf, GroupReg & Record<Name, (keyof Conf)[]>> {
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
        if (
          existing.property !== incoming.property ||
          existing.scale !== incoming.scale ||
          existing.transform !== incoming.transform ||
          existing.negative !== incoming.negative
        ) {
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
      this.#includesRegistry
    );
  }

  addProps<
    Conf extends Record<string, Prop> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(config: Conf): SystemBuilder<PropReg & Conf, GroupReg> {
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
        if (
          existing.property !== incoming.property ||
          existing.scale !== incoming.scale ||
          existing.transform !== incoming.transform ||
          existing.negative !== incoming.negative
        ) {
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
      this.#includesRegistry
    );
  }

  build(): {
    system: SystemInstance<PropReg, GroupReg>;
    createGlobalStyles: GlobalStylesFactory;
  } {
    const animus = new Animus<PropReg, GroupReg>(
      this.#propRegistry,
      this.#groupRegistry
    );

    const propRegistry = this.#propRegistry;
    const groupRegistry = this.#groupRegistry;
    const selectorRegistry = this.#selectorRegistry;

    const system = Object.assign(animus, {
      toConfig: (): SerializedConfig => {
        return serializeInstance(propRegistry, groupRegistry, selectorRegistry);
      },
    }) as SystemInstance<PropReg, GroupReg>;

    const createGlobalStyles: GlobalStylesFactory = (
      styles: GlobalStyleMap
    ): GlobalStyleBlock => {
      return {
        __brand: 'GlobalStyleBlock' as const,
        styles,
      };
    };

    return { system, createGlobalStyles };
  }
}

export type SystemInstance<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
> = Animus<PropReg, GroupReg> & {
  toConfig(): SerializedConfig;
};

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  selectorAliases: string;
  selectorOrder: string;
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
>(
  propRegistry: PropReg,
  groupRegistry: GroupReg,
  selectorRegistry: SelectorAliasMap
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

  const { selectors, order } = serializeSelectorMap(selectorRegistry);

  return {
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
    selectorAliases: JSON.stringify(selectors),
    selectorOrder: JSON.stringify(order),
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
