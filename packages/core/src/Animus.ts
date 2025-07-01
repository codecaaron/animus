import isPropValid from '@emotion/is-prop-valid';
import styled from '@emotion/styled';
import { merge } from 'lodash';

import { AnimusExtended } from './AnimusExtended';
import { ForwardableProps } from './properties/styledOptions';
import { createParser } from './styles/createParser';
import { createStylist } from './styles/createStylist';
import {
  CSSPropMap,
  CSSProps,
  Parser,
  Prop,
  SystemProps,
  VariantConfig,
} from './types/config';
import { AbstractProps, ThemeProps } from './types/props';
import { CSSObject } from './types/shared';
import { Arg } from './types/utils';

export class AnimusWithAll<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>,
  CustomProps extends Record<string, Prop>,
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

  extend() {
    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      this.activeGroups,
      this.custom
    );
  }

  asElement<T extends keyof JSX.IntrinsicElements>(component: T) {
    const propNames = Object.keys(this.propRegistry);

    const Component = styled(component, {
      shouldForwardProp: (
        prop: PropertyKey
      ): prop is ForwardableProps<T, keyof PropRegistry> =>
        isPropValid(prop as string) && !propNames.includes(prop as string),
    })(this.build());

    return Object.assign(Component, { extend: this.extend.bind(this) });
  }

  asComponent<T extends (props: { className?: string }) => any>(
    AsComponent: T
  ) {
    const propNames = Object.keys(this.propRegistry);
    const StyledComponent = styled(AsComponent, {
      shouldForwardProp: (prop) => !propNames.includes(prop),
    })(this.build());
    return Object.assign(StyledComponent, { extend: this.extend.bind(this) });
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

    return Object.assign(handler, { extend: this.extend.bind(this) });
  }
}

class AnimusWithSystem<
  PropRegistry extends Record<string, Prop>,
  GroupRegistry extends Record<string, (keyof PropRegistry)[]>,
  BaseParser extends Parser<PropRegistry>,
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
  Variants extends Record<string, VariantConfig>,
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
  ActiveGroups extends Record<string, true>,
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
  States extends CSSPropMap<AbstractProps, SystemProps<BaseParser>>,
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
  Variants extends Record<string, VariantConfig>,
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
    PropKey extends Readonly<string> = 'variant',
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
  BaseStyles extends CSSProps<AbstractProps, SystemProps<BaseParser>>,
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
    PropKey extends Readonly<string> = 'variant',
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
  BaseParser extends Parser<PropRegistry>,
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
