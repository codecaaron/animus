import { createTheme } from '@animus-ui/theming';

import { Animus } from './Animus';
import { PropertyBuilder } from './PropertyBuilder';
import { NamedTransform } from './transforms/createTransform';
import { Prop } from './types/config';
import { BaseTheme } from './types/theme';

/**
 * Force TypeScript to eagerly evaluate a type, flattening nested
 * generic computations (like MergeTheme chains) into a shallow object.
 * Without this, the ThemeBuilder's recursive type accumulation
 * exceeds TypeScript's instantiation depth limit.
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

interface SerializedPropEntry {
  property: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

type ThemeBuilderInput = ReturnType<typeof createTheme<any>>;

export class SystemBuilder<
  T extends BaseTheme = BaseTheme,
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
> {
  #tokens: T;
  #propRegistry: PropReg;
  #groupRegistry: GroupReg;

  constructor(tokens?: T, propRegistry?: PropReg, groupRegistry?: GroupReg) {
    this.#tokens = tokens || ({} as T);
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
  }

  withTokens<NextT extends BaseTheme>(
    cb: (t: ThemeBuilderInput) => NextT
  ): SystemBuilder<Simplify<NextT>, PropReg, GroupReg> {
    const themeBuilder = createTheme({
      breakpoints: { xs: 0, sm: 0, md: 0, lg: 0, xl: 0 },
    } as any);
    const tokens = cb(themeBuilder);
    return new SystemBuilder(tokens, this.#propRegistry, this.#groupRegistry);
  }

  withProperties<
    NextPropReg extends Record<string, Prop>,
    NextGroupReg extends Record<string, (keyof NextPropReg)[]>,
  >(
    cb: (p: PropertyBuilder) => {
      propRegistry: NextPropReg;
      groupRegistry: NextGroupReg;
    }
  ): SystemBuilder<T, NextPropReg, NextGroupReg> {
    const result = cb(new PropertyBuilder());
    return new SystemBuilder(
      this.#tokens,
      result.propRegistry,
      result.groupRegistry
    );
  }

  build(): SystemInstance<T, PropReg, GroupReg> {
    const animus = new Animus<T, PropReg, GroupReg>(
      this.#propRegistry,
      this.#groupRegistry
    );

    return Object.assign(animus, {
      tokens: this.#tokens,
      serialize: (): SerializedConfig => {
        return serializeInstance(
          this.#tokens,
          this.#propRegistry,
          this.#groupRegistry
        );
      },
    }) as SystemInstance<T, PropReg, GroupReg>;
  }
}

export type SystemInstance<
  T extends BaseTheme,
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
> = Animus<T, PropReg, GroupReg> & {
  tokens: T;
  serialize(): SerializedConfig;
};

export interface SerializedConfig {
  tokens: any;
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
>(
  tokens: any,
  propRegistry: PropReg,
  groupRegistry: GroupReg
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

  return {
    tokens,
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
  };
}

export function createSystem() {
  return new SystemBuilder();
}
