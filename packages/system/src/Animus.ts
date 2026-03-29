import { AnimusExtended } from './AnimusExtended';
import { createComponent } from './runtime';
import { createClassResolver } from './runtime/createClassResolver';
import type {
  AnimusComponent,
  AnimusWrappedComponent,
} from './types/component';
import {
  AbstractParser,
  CompoundEntry,
  CSSPropMap,
  CSSProps,
  Prop,
  SystemProps,
  ThemedCSSPropMap,
  ThemedCSSProps,
  VariantConfig,
} from './types/config';
import { AbstractProps } from './types/props';
import { deepMerge } from './utils/deepMerge';

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
  compounds: CompoundEntry[] = [];

  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups,
    custom: CustomProps,
    compounds: CompoundEntry[] = []
  ) {
    this.propRegistry = props;
    this.groupRegistry = groups;
    this.baseStyles = base;
    this.variants = variants;
    this.statesConfig = states;
    this.activeGroups = activeGroups;
    this.custom = custom;
    this.compounds = compounds;
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
      this.custom,
      this.compounds
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

  asClass(): (props?: Record<string, unknown>) => string {
    const config = this._buildComponentConfig();
    return createClassResolver('', config);
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
    activeGroups: ActiveGroups,
    compounds: CompoundEntry[] = []
  ) {
    super(props, groups, base, variants, states, activeGroups, {}, compounds);
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
      config,
      this.compounds
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
    states: States,
    compounds: CompoundEntry[] = []
  ) {
    super(props, groups, base, variants, states, {}, compounds);
  }

  system<
    PickedKeys extends
      | keyof GroupRegistry
      | Extract<keyof PropRegistry, string>,
  >(config: Record<PickedKeys, true>) {
    return new AnimusWithSystem<
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants,
      States,
      Record<PickedKeys, true>
    >(
      this.propRegistry,
      this.groupRegistry,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      config,
      this.compounds
    );
  }
}

class AnimusWithCompounds<
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
    variants: Variants,
    compounds: CompoundEntry[] = []
  ) {
    super(props, groups, base, variants, {}, compounds);
  }

  compound<Props extends AbstractProps>(
    condition: {
      [K in keyof Variants]?:
        | keyof Variants[K]['variants']
        | ReadonlyArray<keyof Variants[K]['variants']>;
    },
    styles: ThemedCSSProps<Props, PropRegistry>
  ) {
    return new AnimusWithCompounds<
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants
    >(this.propRegistry, this.groupRegistry, this.baseStyles, this.variants, [
      ...this.compounds,
      { condition: condition as Record<string, string>, styles: styles as any },
    ]);
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
      config,
      this.compounds
    );
  }
}

class AnimusWithVariants<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<AbstractParser>>,
  Variants extends Record<string, VariantConfig>,
> extends AnimusWithCompounds<
  PropRegistry,
  GroupRegistry,
  BaseStyles,
  Variants
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    base: BaseStyles,
    variants: Variants,
    compounds: CompoundEntry[] = []
  ) {
    super(props, groups, base, variants, compounds);
  }

  compound<Props extends AbstractProps>(
    condition: {
      [K in keyof Variants]?:
        | keyof Variants[K]['variants']
        | ReadonlyArray<keyof Variants[K]['variants']>;
    },
    styles: ThemedCSSProps<Props, PropRegistry>
  ) {
    return new AnimusWithCompounds<
      PropRegistry,
      GroupRegistry,
      BaseStyles,
      Variants
    >(this.propRegistry, this.groupRegistry, this.baseStyles, this.variants, [
      ...this.compounds,
      { condition: condition as Record<string, string>, styles: styles as any },
    ]);
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
      deepMerge(this.variants as any, { [prop]: options }) as NextVariants,
      this.compounds
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
      deepMerge(this.variants as any, { [prop]: options }) as NextVariants,
      this.compounds
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
