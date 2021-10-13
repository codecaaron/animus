import { merge } from 'lodash';

import { variance } from '../core';
import { Parser, Prop, SystemProps, TransformerMap } from '../types/config';
import {
  AbstractProps,
  CSSPropMap,
  CSSProps,
  ThemeProps,
} from '../types/props';

import { Arg, PropConfig } from '../types/config';
import { createConfig } from '../createConfig';

// TODO: Add optional style object for parser.
// TODO: Add optional order specificty for parsers (CSS shouldn't use it).
/**
 * Selectors
 * 1. Ensure basic ordering of interactive states
 * 2. Deduplication and default ordering
 */

/**
 * Templating:
 * 1. Base CSS
 * 2. Variant CSS
 * 3. States CSS
 * 4. Prop CSS
 *
 * Steps:
 * 1. CSS
 * 2. Ordered Selectors
 */

/**
 * 1. Order Sets of Props
 * 2. Remove Duplicates
 * 3. Initialize Style Object
 */

class VariaWithVariants<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  G extends (keyof C['groups'])[] | never[],
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  States extends CSSPropMap<AbstractProps, SystemProps<P>>,
  Variants extends Record<
    string,
    {
      prop?: any;
      defaultVariant?: any;
      base?: CSSProps<AbstractProps, SystemProps<P>>;
      variants: CSSPropMap<AbstractProps, SystemProps<P>>;
    }
  >
> {
  props = {} as C;
  parser = {} as P;
  groups = [] as G;
  base = {} as Base;
  states = {} as States;
  variants = {} as Variants;

  constructor(
    props: C,
    parser: P,
    groups: G,
    base: Base,
    states: States,
    variants: Variants
  ) {
    this.props = props;
    this.parser = parser;
    this.groups = groups;
    this.base = base;
    this.states = states;
    this.variants = variants;
  }

  withVariants<
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

    return new VariaWithVariants(
      this.props,
      this.parser,
      this.groups,
      this.base,
      this.states,
      merge(this.variants, { [prop]: options }) as NextVariants
    );
  }

  build() {
    type Props = ThemeProps<
      {
        [K in keyof Arg<P> as `${K extends C['groups'][G[number]][number]
          ? K
          : never}`]?: Arg<P>[K];
      } & { [K in keyof Variants]?: keyof Variants[K]['variants'] } & {
        [K in keyof States]?: boolean;
      }
    >;

    const handler = (props: { [K in keyof Props]: Props[K] }) => ({});

    return handler;
  }
}

class VariaWithStates<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  G extends (keyof C['groups'])[] | never[],
  Base extends CSSProps<AbstractProps, SystemProps<P>>,
  States extends CSSPropMap<AbstractProps, SystemProps<P>>
> extends VariaWithVariants<C, P, G, Base, States, {}> {
  constructor(props: C, parser: P, groups: G, base: Base, states: States) {
    super(props, parser, groups, base, states, {});
  }
}

class VariaWithBase<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  G extends (keyof C['groups'])[] | never[],
  Base extends CSSProps<AbstractProps, SystemProps<P>>
> extends VariaWithVariants<C, P, G, Base, {}, {}> {
  constructor(props: C, parser: P, groups: G, base: Base) {
    super(props, parser, groups, base, {}, {});
  }

  withStates<Props extends AbstractProps>(
    config: CSSPropMap<Props, SystemProps<P>>
  ) {
    return new VariaWithStates(
      this.props,
      this.parser,
      this.groups,
      this.base,
      config
    );
  }
}

class VariaWithProps<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  G extends (keyof C['groups'])[] | never[]
> extends VariaWithBase<C, P, G, {}> {
  constructor(props: C, parser: P, groups: G) {
    super(props, parser, groups, {});
  }
  withBase<Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<P>>
  ) {
    return new VariaWithBase(this.props, this.parser, this.groups, config);
  }
}

class VariaWithSystemProps<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>,
  G extends (keyof C['groups'])[] | never[]
> extends VariaWithProps<C, P, G> {
  constructor(props: C, parser: P, groups: G) {
    super(props, parser, groups);
  }
  withProps<ExtraProps extends Record<string, Prop>>(config: ExtraProps) {
    const newProps = { ...this.props.props, ...config } as C['props'] &
      ExtraProps;
    const parser = variance.create(newProps);
    return new VariaWithProps(
      { ...this.props, props: newProps },
      parser,
      this.groups
    );
  }
}

class Varia<
  C extends PropConfig,
  P extends Parser<TransformerMap<C['props']>>
> extends VariaWithSystemProps<C, P, []> {
  constructor(config: C) {
    super(config, variance.create(config.props) as P, []);
  }
  withSystemProps<PickedGroups extends keyof C['groups']>(
    config: Record<PickedGroups, true>
  ) {
    return new VariaWithSystemProps(
      this.props,
      this.parser,
      Object.keys(config) as PickedGroups[]
    );
  }
}

export const createProps = <Config extends PropConfig>(config: Config) =>
  new Varia(config);

const config = createConfig()
  .addGroup('space', {
    m: { property: 'margin' },
    p: { property: 'padding' },
  })
  .build();

const api = createProps(config)
  .withSystemProps({ space: true })
  .withBase({ m: '-moz-initial' })
  .build();

api({ m: 'initial' });
