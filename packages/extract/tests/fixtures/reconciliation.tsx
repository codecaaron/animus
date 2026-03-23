import { animus } from '@animus-ui/core';

// Component with 3 variant options — only "stroke" will be used in JSX
export const Button = animus
  .styles({ display: 'inline-flex', cursor: 'pointer' })
  .variant({
    variants: {
      fill: { color: 'background', bg: 'primary' },
      stroke: { border: 1, color: 'primary' },
      ghost: { bg: 'transparent', color: 'text' },
    },
    defaultVariant: 'fill',
  })
  .states({
    disabled: { opacity: 0.5, cursor: 'not-allowed' },
    loading: { opacity: 0.7 },
  })
  .asElement('button');

// Component that is NEVER rendered in JSX (dead component)
export const Spacer = animus.styles({ display: 'block' }).asElement('div');

// JSX usage — only "stroke" variant used, only "disabled" state activated
// Button rendered WITHOUT variant prop → default "fill" implicitly used
export function App() {
  return (
    <div>
      <Button variant="stroke" disabled>
        Click
      </Button>
      <Button>Default</Button>
    </div>
  );
}
