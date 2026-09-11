import { compose } from '@animus-ui/system/compose';

import { ds } from '../test-system';

const Root = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    p: 8,
    containerType: 'inline-size',
    containerName: 'card',
  })
  .asElement('article');

const Media = ds
  .styles({
    width: '100%',
    '@container card (min-width: 400px)': { width: '50cqw', p: 16 },
  })
  .asElement('div');

const Body = ds
  .styles({
    '@container card (min-width: 400px)': { p: 16 },
  })
  .asElement('div');

export const ContainerCard = compose(
  { Root, Media, Body },
  { name: 'ContainerCard', shared: {} }
);
export const App = () => (
  <ContainerCard.Root>
    <ContainerCard.Media />
    <ContainerCard.Body />
  </ContainerCard.Root>
);
