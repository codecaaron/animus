import isPropValid from '@emotion/is-prop-valid';

/**
 * Emotion will not attempt to forward all system props - so this pre filters all possible exceptions to search agains
 * props like `color` and `width`.
 */

export type ForwardableProps<
  El extends keyof JSX.IntrinsicElements,
  Reserved
> = Exclude<
  El extends keyof JSX.IntrinsicElements
    ? keyof JSX.IntrinsicElements[El]
    : keyof Element,
  Reserved
>;

/**
 * @description
 * This object can be passed to the second argument of `styled('div', styledOptions)` or be called as a function to filter additional prop names
 * If you are extending a component that already has filtered props - you do not need to provide additional guards if  you are not passing additional props
 * @example
 */
export const createStyledOptions = <T extends Record<string, any>>(
  props: T
) => {
  const reserved = ['mode', 'variant', ...Object.keys(props)];
  const validPropnames = reserved.filter(isPropValid);

  const bindShouldForward = <
    El extends keyof JSX.IntrinsicElements = 'div',
    Forward extends string = never,
    Filter extends string = never
  >(opts?: {
    element?: El;
    forward?: readonly Forward[];
    filter?: readonly Filter[];
  }) => {
    return {
      shouldForwardProp: (
        prop: PropertyKey
      ): prop is
        | ForwardableProps<El, keyof T | 'variant' | 'mode' | Filter>
        | Forward =>
        opts?.forward?.includes(prop as Forward) ||
        (isPropValid(prop as string) &&
          !validPropnames.includes(prop as string) &&
          !opts?.filter?.includes(prop as Filter)),
    };
  };

  return Object.assign(bindShouldForward, bindShouldForward());
};
