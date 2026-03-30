import { ds } from '../test-system';

// Test: auto-emission (bg: 'background' should emit --current-bg sibling)
export const Card = ds
  .styles({
    bg: 'background',
    p: 16,
  })
  .asElement('div');

// Test: contextual var as direct value (borderColorTop: 'current-bg')
export const Divider = ds
  .styles({
    borderColorTop: 'current-bg',
  })
  .asElement('hr');

// Test: self-referential guard (bg: 'current-bg' should NOT emit circular --current-bg)
export const InheritBg = ds
  .styles({
    bg: 'current-bg',
  })
  .asElement('div');

// Test: token ref syntax ({colors.current-bg} in string value)
export const GlowBox = ds
  .styles({
    boxShadow: '0 0 8px {colors.current-bg}',
  })
  .asElement('div');

// Test: responsive bg auto-emission
export const ResponsiveCard = ds
  .styles({
    bg: { _: 'background', md: 'primary' },
  })
  .asElement('div');

// JSX consumer — renders all components so reconciler keeps them
export function ContextualVarsDemo() {
  return (
    <Card>
      <Divider />
      <InheritBg />
      <GlowBox />
      <ResponsiveCard />
    </Card>
  );
}
