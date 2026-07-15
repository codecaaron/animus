// Review F4 witness: a props() config that evaluates statically but
// fails PropConfigMap deserialization (property must be a string) is
// SILENTLY dropped from the manifest — the chain stays live in source
// and its runtime import must SURVIVE (v1 967-969 + manifest-membership
// import gating).
export const Broken = ds
  .props({ w: { property: 123 } })
  .asElement('div');
export const App = () => <Broken />;
