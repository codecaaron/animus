import {
  createElement,
  forwardRef,
  type ForwardRefExoticComponent,
} from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createComponent } from '../src/runtime';

// Contract: an asComponent() target receives exactly the variants and states
// its terminal forwards, a variant as its resolved value (the written one,
// else its default), a state as written; the classes are unchanged, and a
// string terminal forwards nothing.
interface WrapperProps {
  size?: string;
  error?: boolean;
}

interface TargetProps extends WrapperProps {
  className?: string;
}

describe('asComponent forward', () => {
  const variants = { size: { options: ['small', 'large'], default: 'small' } };
  const render = (
    forward: true | readonly string[] | undefined,
    props: WrapperProps
  ) => {
    let received: TargetProps = {};
    const Target = forwardRef<HTMLElement, TargetProps>((targetProps, _ref) => {
      received = targetProps;
      return null;
    });
    const config: Parameters<typeof createComponent>[2] = {
      variants,
      states: ['error'],
    };
    if (forward) config.forward = forward;
    const Wrapped: ForwardRefExoticComponent<any> = createComponent(
      Target,
      'w',
      config
    );
    renderToStaticMarkup(createElement(Wrapped, props));
    return received;
  };

  it('hands the target nothing it does not forward', () => {
    expect(render(undefined, { size: 'large', error: true })).toEqual({
      className: 'w w--size-large w--error',
    });
  });

  it('hands the target each listed name, a variant resolved', () => {
    expect(render(['size', 'error'], {})).toEqual({
      className: 'w w--size-default',
      size: 'small',
    });
    expect(render(['size'], { size: 'large', error: true })).toEqual({
      className: 'w w--size-large w--error',
      size: 'large',
    });
  });

  it('hands the target every variant and state with `true`', () => {
    expect(render(true, { size: 'large', error: true })).toEqual({
      className: 'w w--size-large w--error',
      size: 'large',
      error: true,
    });
  });

  it('forwards nothing to a string terminal', () => {
    const Box: ForwardRefExoticComponent<any> = createComponent('div', 'b', {
      variants,
      states: ['error'],
      forward: true,
    });
    expect(
      renderToStaticMarkup(createElement(Box, { size: 'large', error: true }))
    ).toBe('<div class="b b--size-large b--error"></div>');
  });
});
