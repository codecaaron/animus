import { createAnimus } from '../animus/createAnimus';

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
    });

    const test = {
      margin: 'revert',
      padding: 'initial',
      transform: 'rotate(360deg)',
      '@media screen and (min-width: 480px)': {
        transform: 'rotate(360deg)',
      },
      '@media screen and (min-width: 768px)': {
        transform: 'none',
      },
      '@media screen and (min-width: 1024px)': {
        margin: 'unset',
      },
      '&:active': {
        display: 'none',
      },
      '&:hover': {
        color: 'purple',
        margin: '4px',
        padding: '4',
        '@media screen and (min-width: 480px)': {
          padding: '8',
        },
        '@media screen and (min-width: 768px)': {
          margin: '8px',
          padding: '12',
        },
        '@media screen and (min-width: 1440px)': {
          margin: '12px',
        },
      },
    };

    expect(stylies).toEqual(test);
  });
});
