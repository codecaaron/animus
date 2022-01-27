import { createAnimus } from '../createAnimus';

describe('createAnimus', () => {
  const animus = createAnimus()
    .addGroup('cool', {
      m: { property: 'margin' },
      p: { property: 'padding' },
      fontFamily: {
        property: 'fontFamily',
        scale: 'fontFamily',
      },
      size: {
        property: 'width',
      },
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
    .variant({
      prop: 'size',
      variants: {
        lg: { paddingLeft: '4px' },
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
    .groups({ cool: true })
    .props({ coolio: { property: 'transform' } })
    .build();

  it('renders', () => {
    const stylies = styles({
      variant: 'foo',
      p: 'initial',
      dude: true,
      fontFamily: 'body',
      woah: true,
      test: 'fizz',
      size: 'lg',
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
      fontFamily: 'Verdana, sans-serif',
      paddingLeft: '4px',
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
