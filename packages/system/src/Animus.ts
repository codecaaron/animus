import { AnimusExtended } from './AnimusExtended';
import { createComponent } from './runtime';
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
  ThemedCSSPropMap,
  ThemedCSSProps,
  VariantConfig,
} from './types/config';
import { AbstractProps, ThemeProps } from './types/props';
import { CSSObject } from './types/shared';
import { Theme } from './types/theme';

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
      Theme
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
      const prop = vc.prop || key;
      variantConfig[prop] = {
        options: Object.keys(vc.variants || {}),
        default: vc.defaultVariant,
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
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
  ActiveGroups extends Record<string, true>,
> extends AnimusWithAll<
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
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
> extends AnimusWithSystem<
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
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
> extends AnimusWithStates<
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
    config: ThemedCSSPropMap<Props, PropRegistry>
  ) {
    return new AnimusWithStates<
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
    defaultVariant?: Extract<keyof Props, string>;
    base?: ThemedCSSProps<Base, PropRegistry>;
    variants: ThemedCSSPropMap<Props, PropRegistry>;
  }) {
    type NextVariants = Variants & Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants<
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
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
> extends AnimusWithVariants<PropRegistry, GroupRegistry, BaseStyles, {}> {
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
    defaultVariant?: Extract<keyof Props, string>;
    base?: ThemedCSSProps<Base, PropRegistry>;
    variants: ThemedCSSPropMap<Props, PropRegistry>;
  }) {
    type NextVariants = Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants<
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
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
> extends AnimusWithBase<PropRegistry, GroupRegistry, {}> {
  constructor(props: PropRegistry, groups: GroupRegistry) {
    super(props, groups, {});
  }
  styles<Props extends AbstractProps>(
    config: ThemedCSSProps<Props, PropRegistry>
  ) {
    return new AnimusWithBase<PropRegistry, GroupRegistry, typeof config>(
      this.propRegistry,
      this.groupRegistry,
      config
    );
  }
}
