import { createAnimus } from '../';
import { createConfig } from '../..';

const theme = {
  breakpoints: { xs: '480', sm: '767', md: '1024', lg: '1200', xl: '1440' },
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
        md: 'unset',
      },
      '&:hover': {
        margin: 'initial',
      },
    })
    .variant({ variants: { die: { m: 'revert' } } })
    .systemProps({ cool: true })
    .customProps({ coolio: { property: 'transform' } })
    .build();

  it('renders', () => {
    expect(
      styles({
        variant: 'die',
        p: 'initial',
        coolio: {
          _: 'rotate(360deg)',
          xs: 'rotate(360deg)',
          sm: 'none',
        },
        theme,
      })
    ).toEqual({
      margin: 'initial',
      padding: 'initial',
      '&:hover': {
        margin: 'initial',
      },
    });
  });
});
