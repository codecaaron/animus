import { Animus } from './Animus';
import { PropertyBuilder } from './PropertyBuilder';
import { NamedTransform } from './transforms/createTransform';
import { Prop } from './types/config';

interface SerializedPropEntry {
  property: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

export type GlobalStyleMap = Record<string, Record<string, any>>;

export interface GlobalStylesConfig {
  reset?: GlobalStyleMap;
  global?: GlobalStyleMap;
}

export class SystemBuilder<
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
> {
  #propRegistry: PropReg;
  #groupRegistry: GroupReg;
  #globalStyles?: GlobalStylesConfig;

  constructor(
    propRegistry?: PropReg,
    groupRegistry?: GroupReg,
    globalStyles?: GlobalStylesConfig
  ) {
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
    this.#globalStyles = globalStyles;
  }

  withProperties<
    NextPropReg extends Record<string, Prop>,
    NextGroupReg extends Record<string, (keyof NextPropReg)[]>,
  >(
    cb: (p: PropertyBuilder) => {
      propRegistry: NextPropReg;
      groupRegistry: NextGroupReg;
    }
  ): SystemBuilder<NextPropReg, NextGroupReg> {
    const result = cb(new PropertyBuilder());
    return new SystemBuilder(
      result.propRegistry,
      result.groupRegistry,
      this.#globalStyles
    );
  }

  withGlobalStyles(
    styles: GlobalStylesConfig
  ): SystemBuilder<PropReg, GroupReg> {
    return new SystemBuilder(this.#propRegistry, this.#groupRegistry, styles);
  }

  build(): SystemInstance<PropReg, GroupReg> {
    const animus = new Animus<PropReg, GroupReg>(
      this.#propRegistry,
      this.#groupRegistry
    );

    const globalStyles = this.#globalStyles;
    return Object.assign(animus, {
      serialize: (): SerializedConfig => {
        return serializeInstance(
          this.#propRegistry,
          this.#groupRegistry,
          globalStyles
        );
      },
    }) as SystemInstance<PropReg, GroupReg>;
  }
}

export type SystemInstance<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
> = Animus<PropReg, GroupReg> & {
  serialize(): SerializedConfig;
};

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  globalStyles?: GlobalStylesConfig;
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
>(
  propRegistry: PropReg,
  groupRegistry: GroupReg,
  globalStyles?: GlobalStylesConfig
): SerializedConfig {
  const serialized: Record<string, SerializedPropEntry> = {};
  const transforms: Record<string, NamedTransform> = {};

  for (const [propName, entry] of Object.entries(propRegistry)) {
    const s: SerializedPropEntry = { property: (entry as any).property };

    if ((entry as any).properties && (entry as any).properties.length > 0) {
      s.properties = [...(entry as any).properties];
    }

    if (typeof (entry as any).scale === 'string') {
      s.scale = (entry as any).scale;
    }

    if ((entry as any).transform) {
      const fn = (entry as any).transform;
      const name = fn.transformName ?? fn.name;
      if (name) {
        s.transform = name;
        transforms[name] = fn;
      }
    }

    serialized[propName] = s;
  }

  const result: SerializedConfig = {
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
  };

  if (globalStyles) {
    result.globalStyles = globalStyles;
  }

  return result;
}

export function createSystem() {
  return new SystemBuilder();
}
