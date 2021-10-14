import { isEmpty, isObject, pick, set } from 'lodash';
import { AbstractParser } from '../types/config';

type BasicStuff = Record<string, any>;

interface Rules {
  [x: string]: {
    [x: string]: any;
  };
}

/**
 *
 */

const getSelectors = (
  base: BasicStuff = {},
  variants: BasicStuff = {},
  states: BasicStuff = {},
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

export const stylist = (
  parser: AbstractParser,
  base: Record<string, any> = {},
  variants: Record<string, any> = {},
  states: Record<string, any> = {},
  defaults: Record<string, any> = {}
) => {
  const { primary = {}, ...selectors } = getSelectors(
    base,
    variants,
    states,
    parser.propNames
  );

  const getActiveStyleIds = createIdGetter(variants, states);

  return (props: any) => {
    const media = ['xs', 'sm', 'md', 'lg', 'xl'].map(
      (key) => props.theme.breakpoints[key]
    );
    const propStyles = parser(props);
    const activeIds = getActiveStyleIds(props);
    let result: any = {};
    const { base, ...allOverrides } = primary;
    const overrides: any = { ...pick(allOverrides, activeIds), propStyles };

    const {
      [media[0]]: xs = {},
      [media[1]]: sm = {},
      [media[2]]: md = {},
      [media[3]]: lg = {},
      [media[4]]: xl = {},
      ...styles
    } = parser({ ...base, theme: props.theme }, true);
    result = { ...styles };

    Object.keys(overrides).forEach((id) => {
      const {
        [media[0]]: xsOverride,
        [media[1]]: smOverride,
        [media[2]]: mdOverride,
        [media[3]]: lgOverride,
        [media[4]]: xlOverride,
        ...overrideStyles
      } = parser({ ...overrides[id], theme: props.theme }, true);

      for (const rule in overrideStyles) {
        result[rule] = overrideStyles[rule];
      }

      [
        [xs, xsOverride],
        [sm, smOverride],
        [md, mdOverride],
        [lg, lgOverride],
        [xl, xlOverride],
      ].forEach(([mqStyle, mqOverride]: any) => {
        for (const rule in mqOverride) {
          mqStyle[rule] = mqOverride[rule];
        }
      });
    });

    [xs, sm, md, lg, xl].forEach((bp, i) => {
      if (!isEmpty(bp)) {
        result[media[i]] = bp;
      }
    });

    Object.entries(selectors).forEach(([secondarySelector, config = {}]) => {
      const { base, ...overrides } = config;
      const {
        [media[0]]: xs = {},
        [media[1]]: sm = {},
        [media[2]]: md = {},
        [media[3]]: lg = {},
        [media[4]]: xl = {},
        ...styles
      } = parser({ ...base, theme: props.theme }, true);
      const secondaryResult = { ...styles };
      const selectorOverrides = pick(overrides, activeIds);

      Object.keys(selectorOverrides).forEach((id) => {
        const {
          [media[0]]: xsOverride,
          [media[1]]: smOverride,
          [media[2]]: mdOverride,
          [media[3]]: lgOverride,
          [media[4]]: xlOverride,
          ...overrideStyles
        } = parser({ ...selectorOverrides[id], theme: props.theme }, true);

        for (const rule in overrideStyles) {
          secondaryResult[rule] = overrideStyles[rule];
        }

        [
          [xs, xsOverride],
          [sm, smOverride],
          [md, mdOverride],
          [lg, lgOverride],
          [xl, xlOverride],
        ].forEach(([mqStyle = {}, mqOverride]: any) => {
          for (const rule in mqOverride) {
            mqStyle[rule] = mqOverride[rule];
          }
        });
      });

      [xs, sm, md, lg, xl].forEach((bp, i) => {
        if (!isEmpty(bp)) {
          secondaryResult[media[i]] = bp;
        }
      });

      if (!isEmpty(secondaryResult)) {
        result[secondarySelector] = secondaryResult;
      }
    });

    console.log(result);

    return result;
  };
};
