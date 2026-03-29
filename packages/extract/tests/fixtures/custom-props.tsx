import { animus } from '@animus-ui/core';

// Component with custom props: transform, inline scale, and theme scale ref
export const Card = animus
  .styles({
    display: 'flex',
    flexDirection: 'column',
  })
  .system({
    space: true,
  })
  .props({
    sizing: {
      property: 'flexBasis',
      transform: 'size',
    },
    density: {
      property: 'gap',
      scale: { compact: '4px', normal: '8px', loose: '16px' },
    },
    indent: {
      property: 'paddingLeft',
      scale: 'space',
    },
  })
  .asElement('div');

// JSX usage — static and dynamic
export function CardExample({ dynamicSize }: { dynamicSize: number }) {
  return (
    <Card p={8} sizing={dynamicSize} density="compact" indent={2}>
      <Card sizing={100} density="loose" indent={4} />
    </Card>
  );
}
