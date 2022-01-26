import { merge } from 'lodash';

import styled from '@emotion/styled';
import { AbstractProps, ThemeProps } from './types/props';
import { CSSObject } from './types/shared';

import {
  Parser,
  Prop,
  SystemProps,
  VariantConfig,
  CSSPropMap,
  CSSProps,
} from './types/config';
import { Arg } from './types/utils';
import { createParser } from './styles/createParser';
import { createStylist } from './styles/createStylist';

export class AnimusWithAll<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>,
  CustomProps extends Record<string, Prop>
> {
  propRegistry = {} as PropRegistry;
  groupRegistry = {} as GroupRegistry;
  parser = {} as BaseParser;
  baseStyles = {} as BaseStyles;
  statesConfig = {} as States;
  variants = {} as Variants;
  activeGroups = {} as ActiveGroups;
  custom = {} as CustomProps;

  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: BaseStyles,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups,
    custom: CustomProps
  ) {
    this.propRegistry = props;
    this.groupRegistry = groups;
    this.parser = parser;
    this.baseStyles = base;
    this.variants = variants;
    this.statesConfig = states;
    this.activeGroups = activeGroups;
    this.custom = custom;
  }

  asComponent<T extends keyof JSX.IntrinsicElements>(component: T) {
    type CustomParser = Arg<Parser<CustomProps>>;
    type GroupProps = GroupRegistry[Extract<
      keyof ActiveGroups,
      keyof GroupRegistry
    >][number];

    type NonGroupProps = {
      [K in keyof Variants]?: keyof Variants[K]['variants'];
    } & {
      [K in keyof States]?: boolean;
    } & {
      [K in keyof CustomParser]: CustomParser[K];
    };

    type Props = ThemeProps<
      Omit<
        {
          [K in keyof Arg<BaseParser> as K extends GroupProps
            ? K
            : never]?: Arg<BaseParser>[K];
        },
        keyof NonGroupProps
      > &
        NonGroupProps
    >;

    const handler = createStylist(
      createParser({ ...this.parser.config, ...this.custom }, [
        ...Object.keys(this.variants),
        ...Object.keys(this.statesConfig),
      ]),
      this.baseStyles,
      this.variants,
      this.statesConfig
    ) as (props: Props) => CSSObject;

    return styled(component)(handler);
  }

  build() {
    type CustomParser = Arg<Parser<CustomProps>>;
    type GroupProps = GroupRegistry[Extract<
      keyof ActiveGroups,
      keyof GroupRegistry
    >][number];

    type NonGroupProps = {
      [K in keyof Variants]?: keyof Variants[K]['variants'];
    } & {
      [K in keyof States]?: boolean;
    } & {
      [K in keyof CustomParser]: CustomParser[K];
    };

    type Props = ThemeProps<
      Omit<
        {
          [K in keyof Arg<BaseParser> as K extends GroupProps
            ? K
            : never]?: Arg<BaseParser>[K];
        },
        keyof NonGroupProps
      > &
        NonGroupProps
    >;

    const handler = createStylist(
      createParser({ ...this.parser.config, ...this.custom }, [
        ...Object.keys(this.variants),
        ...Object.keys(this.statesConfig),
      ]),
      this.baseStyles,
      this.variants,
      this.statesConfig
    ) as (props: Props) => CSSObject;

    return handler;
  }
}

class AnimusWithSystem<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>
> extends AnimusWithAll<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  BaseStyles,
  Variants,
  States,
  ActiveGroups,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: BaseStyles,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups
  ) {
    super(props, groups, parser, base, variants, states, activeGroups, {});
  }

  props<CustomProps extends Record<string, Prop>>(config: CustomProps) {
    return new AnimusWithAll(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
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
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>
> extends AnimusWithSystem<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  BaseStyles,
  Variants,
  States,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: BaseStyles,
    variants: Variants,
    states: States
  ) {
    super(props, groups, parser, base, variants, states, {});
  }

  groups<PickedGroups extends keyof GroupRegistry>(
    config: Record<PickedGroups, true>
  ) {
    return new AnimusWithSystem(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
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
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>
> extends AnimusWithStates<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  BaseStyles,
  Variants,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: BaseStyles,
    variants: Variants
  ) {
    super(props, groups, parser, base, variants, {});
  }

  states<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusWithStates(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      this.variants,
      config
    );
  }

  variant<
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant'
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<BaseParser>>;
    variants: CSSPropMap<Props, SystemProps<BaseParser>>;
  }) {
    type NextVariants = Variants & Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

class AnimusWithBase<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>
> extends AnimusWithVariants<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  BaseStyles,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: BaseStyles
  ) {
    super(props, groups, parser, base, {});
  }
  variant<
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant'
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<BaseParser>>;
    variants: CSSPropMap<Props, SystemProps<BaseParser>>;
  }) {
    type NextVariants = Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

export class Animus<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>
> extends AnimusWithBase<PropRegistry, GroupRegistry, BaseParser, {}> {
  constructor(props: PropRegistry, groups: GroupRegistry) {
    super(props, groups, createParser(props) as BaseParser, {});
  }
  styles<Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusWithBase(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      config
    );
  }
}
