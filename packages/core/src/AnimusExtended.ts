import isPropValid from '@emotion/is-prop-valid';
import styled from '@emotion/styled';
import { merge } from 'lodash';

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

export class AnimusExtended<
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

  styles<Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      merge({}, this.baseStyles, config),
      this.variants,
      this.statesConfig,
      this.activeGroups,
      this.custom
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

    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      merge({}, this.variants, { [prop]: options }) as NextVariants,
      this.statesConfig,
      this.activeGroups,
      this.custom
    );
  }

  states<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<BaseParser>>
  ) {
    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      this.variants,
      merge({}, this.statesConfig, config),
      this.activeGroups,
      this.custom
    );
  }

  groups<PickedGroups extends keyof GroupRegistry>(
    config: Record<PickedGroups, true>
  ) {
    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      merge({}, this.activeGroups, config),
      this.custom
    );
  }

  props<CustomProps extends Record<string, Prop>>(config: CustomProps) {
    return new AnimusExtended(
      this.propRegistry,
      this.groupRegistry,
      this.parser,
      this.baseStyles,
      this.variants,
      this.statesConfig,
      this.activeGroups,
      merge({}, this.custom, config)
    );
  }

  asElement<T extends keyof JSX.IntrinsicElements>(component: T) {
    const propNames = Object.keys(this.propRegistry);
    const StyledComponent = styled(component, {
      shouldForwardProp: (
        prop: string
      ): prop is ForwardableProps<T, keyof PropRegistry> =>
        isPropValid(prop) && !propNames.includes(prop),
    })(this.build());

    return Object.assign(StyledComponent, { extend: this.extend.bind(this) });
  }

  asComponent<T extends (props: { className?: string }) => any>(
    AsComponent: T
  ) {
    const StyledComponent = styled(AsComponent)(this.build());
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

    return handler;
  }
}
