import { createComponent } from '@animus-ui/runtime';

import { AnimusExtended } from './AnimusExtended';
import type {
  AnimusComponent,
  AnimusWrappedComponent,
} from './types/component';
import {
  AbstractParser,
  CSSPropMap,
  CSSProps,
  Prop,
  SystemProps,
  VariantConfig,
} from './types/config';
import { AbstractProps, ThemeProps } from './types/props';
import { CSSObject } from './types/shared';
import { BaseTheme } from './types/theme';

/**
 * Deep merge utility — replaces lodash.merge for variant accumulation.
 */
function deepMerge<
  A extends Record<string, any>,
  B extends Record<string, any>,
>(target: A, source: B): A & B {
  const result = { ...target } as any;
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export class AnimusWithAll<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
  ActiveGroups extends Record<string, true>,
  CustomProps extends Record<string, Prop>,
> {
  propRegistry = {} as PropRegistry;
  groupRegistry = {} as GroupRegistry;
  baseStyles = {} as BaseStyles;
  statesConfig = {} as States;
  variants = {} as Variants;
  activeGroups = {} as ActiveGroups;
  custom = {} as CustomProps;

  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups,
    custom: CustomProps
  ) {
    this.propRegistry = props;
    this.groupRegistry = groups;
    this.baseStyles = base;
    this.variants = variants;
    this.statesConfig = states;
    this.activeGroups = activeGroups;
    this.custom = custom;
  }

  extend() {
    return new AnimusExtended<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      ActiveGroups,
      CustomProps
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      this.activeGroups,
      this.custom
    );
  }

  asElement<El extends keyof JSX.IntrinsicElements>(component: El) {
    const config = this._buildComponentConfig();
    const Component = createComponent(component, '', config);
    const extendFn = this.extend.bind(this);
    return Object.assign(Component, {
      extend: extendFn,
    }) as unknown as AnimusComponent<
      El,
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      ActiveGroups,
      CustomProps
    >;
  }

  asComponent<C extends (props: { className?: string }) => any>(
    AsComponent: C
  ) {
    const config = this._buildComponentConfig();
    const Component = createComponent(AsComponent as any, '', config);
    const extendFn = this.extend.bind(this);
    return Object.assign(Component, {
      extend: extendFn,
    }) as unknown as AnimusWrappedComponent<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      ActiveGroups,
      CustomProps
    >;
  }

  build() {
    type GroupProps = GroupRegistry[Extract<
      keyof ActiveGroups,
      keyof GroupRegistry
    >][number];

    type NonGroupProps = {
      [K in keyof Variants]?: keyof Variants[K]['variants'];
    } & {
      [K in keyof States]?: boolean;
    };

    type Props = ThemeProps<
      {
        [K in Extract<keyof PropRegistry, GroupProps>]?: any;
      } & NonGroupProps,
      T
    >;

    return Object.assign((() => ({})) as (props: Props) => CSSObject, {
      extend: this.extend.bind(this),
    });
  }

  _buildComponentConfig() {
    const variantConfig: Record<
      string,
      { options: string[]; default?: string }
    > = {};
    for (const [key, vc] of Object.entries(
      this.variants as Record<string, VariantConfig>
    )) {
      const prop = (vc as any).prop || key;
      variantConfig[prop] = {
        options: Object.keys((vc as any).variants || {}),
        default: (vc as any).defaultVariant,
      };
    }

    const states = Object.keys(this.statesConfig);

    const allPropNames = [
      ...Object.keys(this.propRegistry),
      ...Object.keys(this.custom),
    ];

    return {
      variants:
        Object.keys(variantConfig).length > 0 ? variantConfig : undefined,
      states: states.length > 0 ? states : undefined,
      systemPropNames: allPropNames,
    };
  }
}

class AnimusWithSystem<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
  ActiveGroups extends Record<string, true>,
> extends AnimusWithAll<
  T,
  PropRegistry,
  GroupRegistry,
  BaseStyles,
  Variants,
  States,
  ActiveGroups,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups
  ) {
    super(props, groups, base, variants, states, activeGroups, {});
  }

  props<NewCustomProps extends Record<string, Prop>>(config: NewCustomProps) {
    return new AnimusWithAll<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      ActiveGroups,
      NewCustomProps
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      this.activeGroups,
      config
    );
  }
}

class AnimusWithStates<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
> extends AnimusWithSystem<
  T,
  PropRegistry,
  GroupRegistry,
  BaseStyles,
  Variants,
  States,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants,
    states: States
  ) {
    super(props, groups, base, variants, states, {});
  }

  groups<PickedGroups extends keyof GroupRegistry>(
    config: Record<PickedGroups, true>
  ) {
    return new AnimusWithSystem<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      Record<PickedGroups, true>
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      config
    );
  }
}

class AnimusWithVariants<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
> extends AnimusWithStates<
  T,
  PropRegistry,
  GroupRegistry,
  BaseStyles,
  Variants,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants
  ) {
    super(props, groups, base, variants, {});
  }

  states<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<AbstractParser>>
  ) {
    return new AnimusWithStates<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      typeof config
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      this.variants,
      config
    );
  }

  variant<
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant',
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<AbstractParser>>;
    variants: CSSPropMap<Props, SystemProps<AbstractParser>>;
  }) {
    type NextVariants = Variants & Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      NextVariants
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      deepMerge(this.variants as any, { [prop]: options }) as NextVariants
    );
  }
}

class AnimusWithBase<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
> extends AnimusWithVariants<T, PropRegistry, GroupRegistry, BaseStyles, {}> {
  constructor(props: PropRegistry, groups: GroupRegistry, base: BaseStyles) {
    super(props, groups, base, {});
  }

  variant<
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant',
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<AbstractParser>>;
    variants: CSSPropMap<Props, SystemProps<AbstractParser>>;
  }) {
    type NextVariants = Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants<
      T,
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      NextVariants
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      deepMerge(this.variants as any, { [prop]: options }) as NextVariants
    );
  }
}

export class Animus<
  T extends BaseTheme,
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
> extends AnimusWithBase<T, PropRegistry, GroupRegistry, {}> {
  constructor(props: PropRegistry, groups: GroupRegistry) {
    super(props, groups, {});
  }
  styles<Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<AbstractParser>>
  ) {
    return new AnimusWithBase<T, PropRegistry, GroupRegistry, typeof config>(
      this.propRegistry,
      this.groupRegistry,
      config
    );
  }
}
