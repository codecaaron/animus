import { merge } from 'lodash';

import {
  AbstractProps,
  CSSPropMap,
  CSSProps,
  CSSObject,
  ThemeProps,
} from '../types/props';

import { Parser, Prop, SystemProps, Arg, PropConfig } from './configv2';
import { createParser } from './createParser2';
import styled from '@emotion/styled';
import { createStylist } from './createStylist2';

export class AnimusWithAll<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>,
  Base extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<BaseParser>>;
      variants: CSSPropMap<AbstractProps, SystemProps<BaseParser>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>,
  CustomProps extends PropConfig['props']
> {
  props = {} as PropRegistry;
  groups = {} as GroupRegistry;
  parser = {} as BaseParser;
  base = {} as Base;
  statesConfig = {} as States;
  variants = {} as Variants;
  activeGroups = {} as ActiveGroups;
  custom = {} as CustomProps;

  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: Base,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups,
    custom: CustomProps
  ) {
    this.props = props;
    this.groups = groups;
    this.parser = parser;
    this.base = base;
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

    type Props = ThemeProps<
      {
        [K in keyof Arg<BaseParser> as K extends GroupProps
          ? K
          : never]?: Arg<BaseParser>[K];
      } & { [K in keyof Variants]?: keyof Variants[K]['variants'] } & {
        [K in keyof States]?: boolean;
      } & {
        [K in keyof CustomParser]: CustomParser[K];
      }
    >;

    const handler = createStylist(
      createParser({ ...this.parser.config, ...this.custom }),
      this.base,
      this.variants,
      this.statesConfig,
      {}
    ) as (props: { [K in keyof Props]: Props[K] }) => CSSObject;

    return styled(component)(handler);
  }

  build() {
    type CustomParser = Arg<Parser<CustomProps>>;
    type GroupProps = GroupRegistry[Extract<
      keyof ActiveGroups,
      keyof GroupRegistry
    >][number];

    type Props = ThemeProps<
      {
        [K in keyof Arg<BaseParser> as K extends GroupProps
          ? K
          : never]?: Arg<BaseParser>[K];
      } & {
        [K in keyof Variants]?: keyof Variants[K]['variants'];
      } & {
        [K in keyof States]?: boolean;
      } & {
        [K in keyof CustomParser]: CustomParser[K];
      }
    >;

    const handler = createStylist(
      createParser({ ...this.parser.config, ...this.custom }),
      this.base,
      this.variants,
      this.statesConfig,
      {}
    ) as (props: { [K in keyof Props]: Props[K] }) => CSSObject;

    return handler;
  }
}

class AnimusWithSystem<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>,
  Base extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<BaseParser>>;
      variants: CSSPropMap<AbstractProps, SystemProps<BaseParser>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>
> extends AnimusWithAll<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  Base,
  Variants,
  States,
  ActiveGroups,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: Base,
    variants: Variants,
    states: States,
    activeGroups: ActiveGroups
  ) {
    super(props, groups, parser, base, variants, states, activeGroups, {});
  }

  customProps<CustomProps extends Record<string, Prop>>(config: CustomProps) {
    return new AnimusWithAll(
      this.props,
      this.groups,
      this.parser,
      this.base,
      this.variants,
      this.statesConfig,
      this.activeGroups,
      config
    );
  }
}

class AnimusWithStates<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>,
  Base extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<BaseParser>>;
      variants: CSSPropMap<AbstractProps, SystemProps<BaseParser>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>
> extends AnimusWithSystem<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  Base,
  Variants,
  States,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: Base,
    variants: Variants,
    states: States
  ) {
    super(props, groups, parser, base, variants, states, {});
  }

  systemProps<PickedGroups extends keyof GroupRegistry>(
    config: Record<PickedGroups, true>
  ) {
    return new AnimusWithSystem(
      this.props,
      this.groups,
      this.parser,
      this.base,
      this.variants,
      this.statesConfig,
      config
    );
  }
}

class AnimusWithVariants<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>,
  Base extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<BaseParser>>;
      variants: CSSPropMap<AbstractProps, SystemProps<BaseParser>>;
    }
  >
> extends AnimusWithStates<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  Base,
  Variants,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: Base,
    variants: Variants
  ) {
    super(props, groups, parser, base, variants, {});
  }

  states<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusWithStates(
      this.props,
      this.groups,
      this.parser,
      this.base,
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
      this.props,
      this.groups,
      this.parser,
      this.base,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

class AnimusWithBase<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>,
  Base extends CSSProps<AbstractProps, SystemProps<BaseParser>>
> extends AnimusWithVariants<
  PropRegistry,
  GroupRegistry,
  BaseParser,
  Base,
  {}
> {
  constructor(
    props: PropRegistry,
    groups: GroupRegistry,
    parser: BaseParser,
    base: Base
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
      this.props,
      this.groups,
      this.parser,
      this.base,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

export class Animus<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, string[]>,
  BaseParser extends Parser<PropRegistry>
> extends AnimusWithBase<PropRegistry, GroupRegistry, BaseParser, {}> {
  constructor(config: { props: PropRegistry; groups: GroupRegistry }) {
    super(
      config.props,
      config.groups,
      createParser(config.props) as BaseParser,
      {}
    );
  }
  styles<Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusWithBase(this.props, this.groups, this.parser, config);
  }
}

// const test = new Animus({
//   props: { cool: { property: 'margin' } },
//   groups: { cool: ['cool'] },
// }).styles({ cool: });
