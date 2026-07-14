// Multi-component custom props: two components sharing and diverging on
// .props() configs — witnesses total-sorted @layer custom slot-entry
// ordering in the committed v2 surface (expected identical).
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
