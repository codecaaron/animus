import { isEmpty, isObject, pick, set } from 'lodash';
import { CSSObject } from '..';
import { AbstractParser } from '../types/config';

interface AbstractStyleFnConfig {
  [x: string]: any;
}

interface Rules {
  [x: string]: {
    [x: string]: any;
  };
}

const getSelectors = (
  base: AbstractStyleFnConfig = {},
  variants: AbstractStyleFnConfig = {},
  states: AbstractStyleFnConfig = {},
  filters: string[]
) => {
  const rules: Rules = {};
  Object.entries(base).forEach(([key, styles]) => {
    if (!filters.includes(key) && isObject(styles)) {
      set(rules, [key, 'base'], styles);
    } else {
      set(rules, ['primary', 'base', key], styles);
    }
  });

  Object.entries(variants).forEach(([key, { variants: variantConfig }]) => {
    Object.entries(variantConfig).forEach(([option, optionStyles]) => {
      const optionId = `${key}-${option}`;
      Object.entries(optionStyles as any).forEach(([key, styles]) => {
        if (!filters.includes(key) && isObject(styles)) {
          set(rules, [key, optionId], styles);
        } else {
          set(rules, ['primary', optionId, key], styles);
        }
      });
    });
  });

  Object.entries(states).forEach(([optionId, optionStyles]) => {
    Object.entries(optionStyles).forEach(([key, styles]) => {
      if (!filters.includes(key) && isObject(styles)) {
        set(rules, [key, optionId], styles);
      } else {
        set(rules, ['primary', optionId, key], styles);
      }
    });
  });

  return rules;
};

const createIdGetter = (variants: any, states: any) => {
  const vIds = Object.keys(variants);
  const sIds = Object.keys(states);

  return (props: any) => {
    const activeIds: any[] = [];
    vIds.forEach((id) => {
      if (props[id]) {
        activeIds.push(`${id}-${props[id]}`);
      }
    });
    sIds.forEach((id) => {
      if (props[id]) {
        activeIds.push(id);
      }
    });
    return activeIds;
  };
};

const extractBreakpointStyles = (styles: CSSObject, medias: string[]) => {
  const unscoped: CSSObject = {};
  const breakpoint: CSSObject = {};
  Object.entries(styles).forEach(([rule, value]) => {
    const target = medias.includes(rule) ? breakpoint : unscoped;
    target[rule] = value;
  });
  return [unscoped, breakpoint];
};

const applyOverride = (
  override = {},
  baseResult: any,
  breakpointResult: any,
  parser: any,
  theme: any,
  media: any
) => {
  const [overrideStyles, overrideBreakpointStyles] = extractBreakpointStyles(
    parser({ ...override, theme }, true),
    media
  );

  for (const rule in overrideStyles) {
    baseResult[rule] = overrideStyles[rule];
  }

  media.forEach((mq: string) => {
    const mqOverride = overrideBreakpointStyles[mq] as CSSObject;
    if (!mqOverride || isEmpty(mqOverride)) return;

    if (!breakpointResult[mq]) {
      breakpointResult[mq] = {} as CSSObject;
    }

    const mqStyle = breakpointResult[mq] as CSSObject;

    for (const rule in mqOverride) {
      mqStyle[rule] = mqOverride[rule];
    }
  });
};

const applyStyle = (resultStyles: any, config: any, props: any, ctx: any) => {
  const { base } = config;
  const { parser, getMediaSelectors, getActiveOverrides } = ctx;
  const { theme } = props;

  const overrides = Object.values(pick(config, getActiveOverrides(props)));
  const media = getMediaSelectors(props);

  const [styles, breakpointStyles] = extractBreakpointStyles(
    parser({ ...base, theme }, true),
    media
  );

  for (const rule in styles) {
    resultStyles[rule] = styles[rule];
  }

  overrides.forEach((override: {}) => {
    applyOverride(
      override,
      resultStyles,
      breakpointStyles,
      parser,
      theme,
      media
    );
  });

  media.forEach((media: string) => {
    const bp = breakpointStyles[media];
    if (!isEmpty(bp)) {
      resultStyles[media] = bp;
    }
  });
};

export const stylist = (
  parser: AbstractParser,
  base: Record<string, any> = {},
  variants: Record<string, any> = {},
  states: Record<string, any> = {},
  defaults: Record<string, any> = {}
) => {
  const selectorGroups = getSelectors(base, variants, states, parser.propNames);
  const context = {
    parser,
    getMediaSelectors: ({ theme }: any) =>
      ['xs', 'sm', 'md', 'lg', 'xl'].map((key) => theme.breakpoints[key]),
    getActiveOverrides: createIdGetter(variants, states),
  };

  return (props: any) => {
    const { vars } = props;

    const result = { ...vars } as any;

    Object.entries(selectorGroups).forEach(([selectorId, config = {}]) => {
      if (selectorId === 'primary') {
        applyStyle(result, config, props, context);
      } else {
        result[selectorId] = {};
        applyStyle(result[selectorId], config, props, context);
      }
    });

    applyStyle(result, { base: parser(props) }, props, context);

    return result;
  };
};
