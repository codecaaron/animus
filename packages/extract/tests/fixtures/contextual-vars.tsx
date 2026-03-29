import { animus } from '@animus-ui/core';

// Test: auto-emission (bg: 'background' should emit --current-bg sibling)
export const Card = animus
  .styles({
    bg: 'background',
    p: 16,
  })
  .asElement('div');

// Test: contextual var as direct value (borderColorTop: 'current-bg')
export const Divider = animus
  .styles({
    borderColorTop: 'current-bg',
  })
  .asElement('hr');

// Test: self-referential guard (bg: 'current-bg' should NOT emit circular --current-bg)
export const InheritBg = animus
  .styles({
    bg: 'current-bg',
  })
  .asElement('div');

// Test: token ref syntax ({colors.current-bg} in string value)
export const GlowBox = animus
  .styles({
    boxShadow: '0 0 8px {colors.current-bg}',
  })
  .asElement('div');

// Test: responsive bg auto-emission
export const ResponsiveCard = animus
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
