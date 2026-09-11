// Two components sharing and diverging on `.props()` configs: custom-layer
// slot entries emit in one total order, not per-component order.
export const Wide = ds
  .props({ w: { property: 'width', scale: { half: '50%', full: '100%' } } })
  .asElement('div');
export const Tall = ds
  .props({
    h: { property: 'height', scale: { half: '50vh', full: '100vh' } },
    w: { property: 'width', scale: { half: '50%', full: '100%' } },
  })
  .asElement('div');
export const App = () => (
  <div>
    <Wide w="half" />
    <Tall h="full" w="full" />
  </div>
);
