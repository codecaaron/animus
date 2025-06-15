import { matchers } from '@emotion/jest';
import { ThemeProvider } from '@emotion/react';
import styled from '@emotion/styled';
import { animusProps } from '@syzygos/core';
import React, { ComponentProps } from 'react';
import { create } from 'react-test-renderer';

import { theme } from '../__fixtures__/theme';

expect.extend(matchers);

const styles = animusProps.create({
  margin: { property: 'margin', scale: 'spacing' },
  padding: { property: 'padding', scale: 'spacing' },
  width: {
    property: 'width',
    transform: (val: string) => `${parseInt(val, 10) / 16}rem`,
  },
  height: {
    property: 'height',
    transform: (val: string) => `${parseInt(val, 10) / 16}rem`,
  },
});

const setupRender = <T extends React.ElementType, P extends ComponentProps<T>>(
  Component: T,
  defaultProps?: P
) => {
  return (props?: P) => {
    const mergedProps = { ...defaultProps, ...props };
    return create(
      <ThemeProvider theme={theme}>
        <Component {...(mergedProps as P)} />
      </ThemeProvider>
    ).toJSON();
  };
};

describe('style props', () => {
  const render = setupRender(styled.div(styles), {
    margin: { _: 4, xs: 8, sm: 16 },
    padding: { _: 0 },
  });

  it('adds style props to components', () => {
    const result = render();

    expect(result).toHaveStyleRule('margin', '0.25rem');

    expect(result).toHaveStyleRule('margin', '0.5rem', {
      media: '(min-width: 1px)',
    });

    expect(result).toHaveStyleRule('margin', '1rem', {
      media: '(min-width: 2px)',
    });
  });
  it('transforms style props', () => {
    expect(render({ width: '48px' })).toHaveStyleRule('width', '3rem');
  });
  it('composes props', () => {
    const render = setupRender(
      styled.div(
        animusProps.compose(
          styles,
          animusProps.create({ color: { property: 'color' } })
        )
      ),
      {
        color: 'inherit',
        margin: [16, 32],
        width: { _: '24px', xs: '32px' },
      }
    );

    const result = render();

    expect(result).toHaveStyleRule('width', '1.5rem');
    expect(result).toHaveStyleRule('margin', '1rem');
    expect(result).toHaveStyleRule('color', 'inherit');

    expect(result).toHaveStyleRule('width', '2rem', {
      media: '(min-width: 1px)',
    });
    expect(result).toHaveStyleRule('margin', '2rem', {
      media: '(min-width: 1px)',
    });
  });
});
describe('static styles', () => {
  const css = animusProps.createCss({
    bg: { property: 'background' },
  });
  const variant = animusProps.createVariant({
    bg: { property: 'background' },
  });

  describe('Variant integration', () => {
    const Test = styled.div`
      background: yellow;
    `;

    const Div = styled.div(
      variant({
        variants: {
          hi: {
            bg: 'blue',
            '&:hover': {
              bg: 'green',
            },
          },
          ho: {
            bg: 'blue',
            [`> *`]: {
              bg: 'navy',
            },
          },
        },
      })
    );

    const render = setupRender(Div, {
      variant: 'hi',
      children: <Test>Hello</Test>,
    });

    it('generates pseudo selector styles', () => {
      const result = render();
      expect(result).toHaveStyleRule('background', 'blue');
      expect(result).toHaveStyleRule('background', 'green', {
        target: ':hover',
      });
    });

    it('generates selector styles', () => {
      const reseult = render({ variant: 'ho' });
      expect(reseult).toHaveStyleRule('background', 'blue');
      expect(reseult).toHaveStyleRule('background', 'navy', {
        target: '*',
      });
    });

    it('handles falsey values', () => {
      const reseult = render({ variant: false });
      expect(reseult).not.toHaveStyleRule('background', 'blue');
      expect(reseult).not.toHaveStyleRule('background', 'navy', {
        target: '*',
      });
    });
  });

  describe('CSS integration', () => {
    const render = setupRender(
      styled.div(
        css({
          bg: 'blue',
          '&:hover': {
            bg: 'green',
          },
          '> *': {
            bg: 'navy',
          },
        })
      )
    );

    it('generates pseudo selector styles', () => {
      const result = render();
      expect(result).toHaveStyleRule('background', 'blue');
      expect(result).toHaveStyleRule('background', 'green', {
        target: ':hover',
      });
      expect(result).toHaveStyleRule('background', 'navy', {
        target: '*',
      });
    });

    it('merges selector styles', () => {
      const render = setupRender(
        styled.div(
          css({ '&:hover': { color: 'green' } }),
          css({ '&:hover': { color: 'orange' } })
        )
      );

      expect(render()).not.toHaveStyleRule('color', 'green', {
        target: ':hover',
      });
      expect(render()).toHaveStyleRule('color', 'orange', {
        target: ':hover',
      });
    });
    it('can share config objects safely', () => {
      const hoverStyles = { '&:hover': { color: 'green' } } as const;

      const render = setupRender(
        styled.div(css({ ...hoverStyles }), css({ ...hoverStyles }))
      );

      expect(render()).toHaveStyleRule('color', 'green', {
        target: ':hover',
      });
    });
  });
});
