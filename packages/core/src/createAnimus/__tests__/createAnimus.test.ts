import { createAnimus } from '../';
import { createConfig } from '../..';

const minViewport = (breakpoint: number) =>
  `@media screen and (min-width: ${breakpoint}px)`;

const theme = {
  breakpoints: {
    xs: minViewport(480),
    sm: minViewport(767),
    md: minViewport(1024),
    lg: minViewport(1024),
    xl: minViewport(1440),
  },
};

describe('createAnimus', () => {
  const config = createConfig()
    .addGroup('cool', {
      m: { property: 'margin' },
      p: { property: 'padding' },
    })
    .build();

  const animus = createAnimus(config);

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
        die: { m: 'revert', '&:hover': { color: 'green' } },
        hard: { '&:hover': { color: 'orange' } },
      },
    })
    .variant({
      prop: 'test',
      variants: {
        die: {
          m: 'revert',
          '&:hover': { color: 'green' },
          '&:active': { display: 'none' },
        },
        hard: { '&:hover': { color: 'orange' } },
        bro: { '&:active': { color: 'blue' } },
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
      variant: 'die',
      p: 'initial',
      dude: true,
      woah: true,
      test: 'die',
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
