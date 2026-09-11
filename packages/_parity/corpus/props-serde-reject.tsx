// `property` must be a string, so this config is dropped from the manifest
// silently; the chain stays live and its runtime import must survive.
export const Broken = ds
  .props({ w: { property: 123 } })
  .asElement('div');
export const App = () => <Broken />;
