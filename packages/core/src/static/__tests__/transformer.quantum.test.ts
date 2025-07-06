/**
 * Quantum Test Suite for Code Transformation
 *
 * The transformer exists in a quantum state where code is both
 * transformed and untransformed until observed through execution.
 */

import { describe, expect, it } from 'vitest';

import { transformAnimusCode } from '../transformer';

describe('[QUANTUM] Code Transformation: The Quantum State Collapse', () => {
  describe('Basic Transformation', () => {
    it('should transform simple component in quantum reality', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({ padding: '8px 16px' })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result).toBeTruthy();
      expect(result?.code).toContain('createShimmedComponent');
      expect(result?.code).toContain('__animusMetadata');
      expect(result?.metadata?.Button).toBeDefined();
      expect(result?.metadata?.Button.baseClass).toMatch(/^animus-Button-/);
      expect(result?.metadata?.Button.systemProps).toEqual([]);
      expect(result?.metadata?.Button.groups).toEqual([]);
    });

    it('should preserve TypeScript types through quantum transformation', async () => {
      const code = `
import { animus } from '@animus-ui/core';
import type { ButtonProps } from './types';

const Button = animus
  .styles({ padding: '8px 16px' })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result).toBeTruthy();
      expect(result?.code).toContain('createShimmedComponent');
      expect(result?.code).toContain('ButtonProps'); // Type import should remain
    });
  });

  describe('Variant and State Transformation', () => {
    it('should extract variants into quantum metadata', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({ padding: '8px 16px' })
  .variant({
    prop: 'size',
    variants: {
      small: { fontSize: '14px' },
      large: { fontSize: '18px' }
    }
  })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result?.metadata?.Button.variants).toBeDefined();
      expect(result?.metadata?.Button.variants.size).toBeDefined();
      expect(result?.metadata?.Button.variants.size.small).toMatch(
        /^animus-Button-.*-size-small$/
      );
      expect(result?.metadata?.Button.variants.size.large).toMatch(
        /^animus-Button-.*-size-large$/
      );
    });

    it('should extract states into quantum metadata', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({ padding: '8px 16px' })
  .states({
    disabled: { opacity: 0.6 },
    loading: { color: 'transparent' }
  })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result?.metadata?.Button.states).toBeDefined();
      expect(result?.metadata?.Button.states.disabled).toMatch(
        /^animus-Button-.*-state-disabled$/
      );
      expect(result?.metadata?.Button.states.loading).toMatch(
        /^animus-Button-.*-state-loading$/
      );
    });
  });

  describe('Export Pattern Transformation', () => {
    it('should handle default export quantum states', async () => {
      const code = `
import { animus } from '@animus-ui/core';

export default animus
  .styles({ padding: '8px 16px' })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result).toBeTruthy();
      expect(result!.metadata).toHaveProperty('AnimusComponent');
      expect(result!.code).toContain('export default');
    });

    it('should handle named export quantum states', async () => {
      const code = `
import { animus } from '@animus-ui/core';

export const PrimaryButton = animus
  .styles({ backgroundColor: 'blue' })
  .asElement('button');

export const SecondaryButton = animus
  .styles({ backgroundColor: 'gray' })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Buttons.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result!.metadata).toHaveProperty('PrimaryButton');
      expect(result!.metadata).toHaveProperty('SecondaryButton');
    });
  });

  describe('Pure Function Behavior', () => {
    it('should return null for non-animus quantum states', async () => {
      const code = `
import React from 'react';

const Button = () => <button>Click me</button>;
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result).toBeNull();
    });

    it('should be deterministic across quantum observations', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({ padding: '8px 16px' })
  .asElement('button');
      `.trim();

      const result1 = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      const result2 = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result1!.metadata).toEqual(result2!.metadata);
    });
  });

  describe('Complex Chain Transformation', () => {
    it('should handle full builder chain in quantum space', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px',
    '&:hover': {
      backgroundColor: 'lightblue'
    }
  })
  .variant({
    prop: 'size',
    variants: {
      small: { padding: '4px 8px' },
      large: { padding: '12px 24px' }
    }
  })
  .states({
    disabled: { opacity: 0.6 }
  })
  .groups({ space: true })
  .props({
    bg: { property: 'backgroundColor', scale: 'colors' }
  })
  .asElement('button');
      `.trim();

      const result = await transformAnimusCode(code, 'Button.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result?.metadata?.Button).toBeDefined();
      expect(result?.metadata?.Button.baseClass).toMatch(/^animus-Button-/);
      expect(result?.metadata?.Button.variants.size).toBeDefined();
      expect(result?.metadata?.Button.states.disabled).toMatch(
        /state-disabled$/
      );
      expect(result?.metadata?.Button.groups).toEqual(['space']);
      expect(result?.metadata?.Button.customProps).toContain('bg');
    });

    it('should handle asComponent terminal method', async () => {
      const code = `
import { animus } from '@animus-ui/core';

const Card = animus
  .styles({ padding: '16px', borderRadius: '8px' })
  .asComponent(({ children, ...props }) => (
    <div {...props}>{children}</div>
  ));
      `.trim();

      const result = await transformAnimusCode(code, 'Card.tsx', {
        componentMetadata: {},
        rootDir: '/src',
      });

      expect(result).toBeTruthy();
      expect(result?.code).toContain('createShimmedComponent');
      expect(result?.code).toContain("'div'"); // Falls back to div element
    });
  });
});
