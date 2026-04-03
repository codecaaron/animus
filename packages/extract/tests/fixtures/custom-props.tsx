import { ds } from '../test-system';

// Component with custom props: transform, inline scale, and theme scale ref
export const Card = ds
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
      transform: (value: string | number) =>
        typeof value === 'number'
          ? value <= 1 && value >= -1
            ? `${value * 100}%`
            : `${value}px`
          : value,
    },
    density: {
      property: 'gap',
      scale: { compact: '4px', normal: '8px', loose: '16px' },
    },
    indent: {
      property: 'paddingLeft',
      scale: 'space',
    },
    pull: {
      property: 'marginTop',
      scale: 'space',
      negative: true,
    },
  })
  .asElement('div');

// JSX usage — static and dynamic
// .props() scale literals widen to string, breaking ThemedScale resolution for custom prop JSX values
export function CardExample({ dynamicSize }: { dynamicSize: number }) {
  return (
    // @ts-expect-error — scale literal widening in .props() generic
    <Card p={8} sizing={dynamicSize} density="compact" indent={2}>
      {/* @ts-expect-error — scale literal widening in .props() generic */}
      <Card sizing={100} density="loose" indent={4} pull={-8} />
    </Card>
  );
}
