# Animus

This is an experimental package for creating dynamic and typesafe style props.

## Usage

Configure your props with a simple configuration object. The keys of your object become your prop names and their values describe their responsibilities and valid types.

```tsx
import styled from '@emotion/styled';
import { create } from '@animus/core';

const Container = styled.div(
  create({
    w: { property: 'width' },
    p: { property: 'padding', scale: 'spacing' },
  })
);

<Container w="100%" p={[16, 24]}>
  Contained!
</Container>;
```

## Composition

You can compose props that you've created seperately to create new prop functions.

```tsx
import { create } from '@animus/core';

const spacing = create({
  m: { property: 'padding', scale: 'margin' },
  p: { property: 'padding', scale: 'spacing' },
});

const dimensions = create({
  w: { property: 'width' },
  h: { property: 'height' },
});

const combinedProps = compose(spacing, dimensions);

const Box = styled.div(combinedProps);
```

## Static CSS

```tsx
import styled from '@emotion/styled';
import { create } from '@animus/core';

const css = createCss({
  m: { property: 'padding', scale: 'margin' },
  p: { property: 'padding', scale: 'spacing' },
});

const MyCoolThing = styled.div(
  css({
    width: '100%',
    height: '500px',
    p: [32, , 64],
  })
);

const variant = createVariant({
  m: { property: 'padding', scale: 'margin' },
  p: { property: 'padding', scale: 'spacing' },
});

const MyCoolThing = styled.div(
  variant({
    base: { width: '100%' },
    variants: {
      big: {
        height: '500px',
        p: [32, , 64],
      },
      small: {
        height: '250px',
        p: [16, , 32],
      },
    },
  })
);
```
