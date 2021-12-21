import { merge } from 'lodash';

import { Parser, Prop, SystemProps, TransformerMap } from '../types/config';
import {
  AbstractProps,
  CSSPropMap,
  CSSProps,
  CSSObject,
  ThemeProps,
} from '../types/props';

import { Arg, PropConfig } from '../types/config';
import { createStylist } from '../styles/createStylist';
import { create } from './create';
import styled from '@emotion/styled';

export class AnimusWithAll<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<P>>;
      variants: CSSPropMap<AbstractProps, SystemProps<P>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<P>>,
  G extends (keyof C['groups'])[] | never[]
> {
  props = {} as C;
  parser = {} as P;
  groups = [] as G;
  base = {} as Base;
  statesConfig = {} as States;
  variants = {} as Variants;

  constructor(
    props: C,
    parser: P,
    base: Base,
    variants: Variants,
    states: States,
    groups: G
  ) {
    this.props = props;
    this.parser = parser;
    this.groups = groups;
    this.base = base;
    this.statesConfig = states;
    this.variants = variants;
  }

  asComponent<T extends keyof JSX.IntrinsicElements>(component: T) {
    type Props = ThemeProps<
      {
        [K in keyof Arg<P>]?: Arg<P>[K];
      } & { [K in keyof Variants]?: keyof Variants[K]['variants'] } & {
        [K in keyof States]?: boolean;
      }
    >;

    const handler = createStylist(
      this.parser,
      this.base,
      this.variants,
      this.statesConfig,
      {}
    ) as (props: { [K in keyof Props]: Props[K] }) => CSSObject;

    return styled(component)(handler);
  }

  build() {
    type Props = ThemeProps<
      {
        [K in keyof Arg<P>]?: Arg<P>[K];
      } & { [K in keyof Variants]?: keyof Variants[K]['variants'] } & {
        [K in keyof States]?: boolean;
      }
    >;

    const handler = createStylist(
      this.parser,
      this.base,
      this.variants,
      this.statesConfig,
      {}
    ) as (props: Props) => CSSObject;

    return handler;
  }
}

class AnimusWithSystem<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<P>>;
      variants: CSSPropMap<AbstractProps, SystemProps<P>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<P>>,
  G extends (keyof C['groups'])[] | never[]
> extends AnimusWithAll<C, P, Base, Variants, States, G> {
  constructor(
    props: C,
    parser: P,
    base: Base,
    variants: Variants,
    states: States,
    groups: G
  ) {
    super(props, parser, base, variants, states, groups);
  }

  customProps<ExtraProps extends Record<string, Prop>>(config: ExtraProps) {
    const newProps = { ...this.props.props, ...config } as C['props'] &
      ExtraProps;
    const parser = create(newProps);
    return new AnimusWithAll(
      { ...this.props, props: newProps },
      parser,
      this.base,
      this.variants,
      this.statesConfig,
      this.groups
    );
  }
}

class AnimusWithStates<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<P>>;
      variants: CSSPropMap<AbstractProps, SystemProps<P>>;
    }
  >,
  States extends CSSPropMap<AbstractProps, SystemProps<P>>
> extends AnimusWithSystem<C, P, Base, Variants, States, []> {
  constructor(
    props: C,
    parser: P,
    base: Base,
    variants: Variants,
    states: States
  ) {
    super(props, parser, base, variants, states, []);
  }

  systemProps<PickedGroups extends keyof C['groups']>(
    config: Record<PickedGroups, true>
  ) {
    return new AnimusWithSystem(
      this.props,
      this.parser,
      this.base,
      this.variants,
      this.statesConfig,
      Object.keys(config) as PickedGroups[]
    );
  }
}

class AnimusWithVariants<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<P>>;
      variants: CSSPropMap<AbstractProps, SystemProps<P>>;
    }
  >
> extends AnimusWithStates<C, P, Base, Variants, {}> {
  constructor(props: C, parser: P, base: Base, variants: Variants) {
    super(props, parser, base, variants, {});
  }

  states<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<P>>
  ) {
    return new AnimusWithStates(
      this.props,
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
    base?: CSSProps<Base, SystemProps<P>>;
    variants: CSSPropMap<Props, SystemProps<P>>;
  }) {
    type NextVariants = Variants & Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants(
      this.props,
      this.parser,
      this.base,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

class AnimusWithBase<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  Base extends CSSProps<AbstractProps, SystemProps<P>>
> extends AnimusWithVariants<C, P, Base, {}> {
  constructor(props: C, parser: P, base: Base) {
    super(props, parser, base, {});
  }
  variant<
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant'
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<P>>;
    variants: CSSPropMap<Props, SystemProps<P>>;
  }) {
    type NextVariants = Record<PropKey, typeof options>;
    const prop = options.prop || 'variant';

    return new AnimusWithVariants(
      this.props,
      this.parser,
      this.base,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }
}

export class Animus<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>
> extends AnimusWithBase<C, P, {}> {
  constructor(config: C) {
    super(config, create(config.props) as P, {});
  }
  styles<Props extends AbstractProps>(config: CSSProps<Props, SystemProps<P>>) {
    return new AnimusWithBase(this.props, this.parser, config);
  }
}
