import { transformAnimusCode } from '../transformer';

describe('AST Transformer', () => {
  it('should transform a basic animus component', async () => {
    const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px'
  })
  .variant({
    prop: 'size',
    variants: {
      small: { padding: '4px 8px' },
      large: { padding: '12px 24px' }
    }
  })
  .states({
    disabled: { opacity: 0.5 }
  })
  .groups({ space: true })
  .asElement('button');

export default Button;
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeTruthy();
    expect(result?.code).toContain('import { createShimmedComponent }');
    expect(result?.code).toContain(
      "createShimmedComponent('button', 'Button')"
    );
    expect(result?.code).toContain('__animusMetadata');
    expect(result?.metadata?.Button).toBeDefined();
    expect(result?.metadata?.Button?.variants?.size).toBeDefined();
    expect(result?.metadata?.Button?.states?.disabled).toBeDefined();
    expect(result?.metadata?.Button?.groups).toEqual(['space']);
  });

  it('should handle default exports', async () => {
    const code = `
import { animus } from '@animus-ui/core';

export default animus
  .styles({ color: 'red' })
  .asElement('span');
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeTruthy();
    expect(result?.code).toContain(
      "const AnimusComponent = createShimmedComponent('span', 'AnimusComponent')"
    );
    expect(result?.code).toContain('export default AnimusComponent');
  });

  it('should handle named exports', async () => {
    const code = `
import { animus } from '@animus-ui/core';

export const Card = animus
  .styles({ padding: '16px' })
  .asElement('div');
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeTruthy();
    expect(result?.code).toContain(
      "export const Card = createShimmedComponent('div', 'Card')"
    );
  });

  it('should preserve TypeScript types', async () => {
    const code = `
import { animus } from '@animus-ui/core';
import type { ComponentProps } from 'react';

const Button = animus
  .styles({ padding: '8px' })
  .asElement('button');

type ButtonProps = ComponentProps<typeof Button>;

export { Button, type ButtonProps };
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeTruthy();
    expect(result?.code).toContain(
      "import type { ComponentProps } from 'react'"
    );
    expect(result?.code).toContain(
      'type ButtonProps = ComponentProps<typeof Button>'
    );
  });

  it('should skip files without animus imports', async () => {
    const code = `
import React from 'react';

const Component = () => <div>Hello</div>;

export default Component;
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeNull();
  });

  it('should handle asComponent terminal method', async () => {
    const code = `
import { animus } from '@animus-ui/core';

const CustomButton = animus
  .styles({ padding: '8px' })
  .asComponent(({ children, ...props }) => (
    <button {...props}>{children}</button>
  ));
`.trim();

    const result = await transformAnimusCode(code, 'test.tsx', {
      componentMetadata: {},
      rootDir: process.cwd(),
    });

    expect(result).toBeTruthy();
    // For now, asComponent falls back to div
    expect(result?.code).toContain(
      "createShimmedComponent('div', 'CustomButton')"
    );
  });
});
