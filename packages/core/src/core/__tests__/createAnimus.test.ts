import { createAnimus } from '../createAnimus';

const theme = {
  breakpoints: {
    xs: 480,
    sm: 767,
    md: 1024,
    lg: 1024,
    xl: 1440,
  },
};

describe('createAnimus', () => {
  const animus = createAnimus()
    .addGroup('cool', {
      m: { property: 'margin' },
      p: { property: 'padding' },
    })
    .build();

  const styles = animus
    .styles({
      m: {
        _: 'initial',
        sm: 'inherit',
        md: 'unset',
      },
      '&:hover': {
        margin: 'initial',
      },
    })
    .variant({
      variants: {
        foo: { m: 'revert', '&:hover': { color: 'green' } },
        bar: { '&:hover': { color: 'orange' } },
      },
    })
    .variant({
      prop: 'test',
      variants: {
        fizz: {
          m: 'revert',
          '&:hover': { color: 'green' },
          '&:active': { display: 'none' },
        },
        buzz: { '&:hover': { color: 'orange' } },
      },
    })
    .states({
      woah: {
        '&:hover': {
          color: 'purple',
        },
      },
      dude: {
        '&:hover': {
          m: { _: '4px', sm: '8px', xl: '12px' },
          p: ['4', '8', '12'],
        },
      },
    })
    .systemProps({ cool: true })
    .customProps({ coolio: { property: 'transform' } })
    .build();

  it('renders', () => {
    const stylies = styles({
      variant: 'foo',
      p: 'initial',
      dude: true,
      woah: true,
      test: 'fizz',
      coolio: {
        _: 'rotate(360deg)',
        xs: 'rotate(360deg)',
        sm: 'none',
      },
      theme,
    });

    expect(stylies).toEqual({});
  });
});
