/**
 * Quantum Test Suite for Component Identity
 *
 * In the quantum field of component existence, identity is the invariant
 * that persists across all possible realities.
 */

import { describe, expect, it } from 'vitest';

import {
  createComponentHash,
  createComponentIdentity,
  extractComponentReferences,
  isSameComponent,
  parseExtendsReference,
} from '../component-identity';
import { EdgeCaseGenerators } from './test-utils';

describe('[QUANTUM] Component Identity: The Names That Echo Across the ABYSS', () => {
  // Component identity tests are pure functions - no harness needed

  describe('Hash Creation: The Deterministic Signatures', () => {
    it('should create consistent hashes in quantum reality', () => {
      // Create the same component in different quantum states
      const reality1 = createComponentHash('/src/Button.tsx', 'Button');
      const reality2 = createComponentHash('/src/Button.tsx', 'Button');

      // Quantum law: Same input MUST produce same hash
      expect(reality1).toBe(reality2);
      expect(reality1).toHaveLength(8);
    });

    it('should create different hashes for different quantum states', () => {
      const button = createComponentHash('/src/Button.tsx', 'Button');
      const card = createComponentHash('/src/Card.tsx', 'Card');

      expect(button).not.toBe(card);
    });

    it('should handle default export quantum states', () => {
      const defaultHash = createComponentHash('/src/Component.tsx', 'default');
      const namedHash = createComponentHash('/src/Component.tsx', 'Component');

      expect(defaultHash).not.toBe(namedHash);
      expect(defaultHash).toHaveLength(8);
    });

    it('should distinguish same-named components in parallel realities', () => {
      // Same name, different files - parallel quantum realities
      const uiButton = createComponentHash('/ui/Button.tsx', 'Button');
      const componentsButton = createComponentHash(
        '/components/Button.tsx',
        'Button'
      );

      expect(uiButton).not.toBe(componentsButton);
    });
  });

  describe('Identity Creation: The Complete Quantum State', () => {
    it('should create complete component identities', () => {
      const identity = createComponentIdentity(
        'Button',
        '/src/components/Button.tsx',
        'Button'
      );

      expect(identity).toMatchObject({
        name: 'Button',
        filePath: '/src/components/Button.tsx',
        exportName: 'Button',
      });
      expect(identity.hash).toBeDefined();
      expect(identity.hash).toHaveLength(8);
    });

    it('should handle quantum entangled identities', () => {
      // Create identities that might be entangled
      const parent = createComponentIdentity('Base', '/src/Base.tsx', 'Base');
      const child = createComponentIdentity(
        'Extended',
        '/src/Extended.tsx',
        'Extended'
      );

      // They should have different hashes despite potential relationship
      expect(parent.hash).not.toBe(child.hash);
    });
  });

  describe('Identity Comparison: Quantum Equality', () => {
    it('should recognize identical quantum states', () => {
      const identity1 = createComponentIdentity(
        'Button',
        '/src/Button.tsx',
        'Button'
      );
      const identity2 = createComponentIdentity(
        'Button',
        '/src/Button.tsx',
        'Button'
      );

      expect(isSameComponent(identity1, identity2)).toBe(true);
    });

    it('should distinguish different quantum states', () => {
      const button = createComponentIdentity(
        'Button',
        '/src/Button.tsx',
        'Button'
      );
      const card = createComponentIdentity('Card', '/src/Card.tsx', 'Card');

      expect(isSameComponent(button, card)).toBe(false);
    });

    it('should handle quantum state edge cases', () => {
      const identity1 = createComponentIdentity(
        'Component',
        '/src/index.tsx',
        'default'
      );
      const identity2 = createComponentIdentity(
        'Component',
        '/src/index.tsx',
        'Component'
      );

      expect(isSameComponent(identity1, identity2)).toBe(false);
    });
  });

  describe('Extension Pattern Detection: Quantum Inheritance', () => {
    it('should detect direct extension in quantum space', () => {
      const code = `
        const PrimaryButton = Button.extend()
          .styles({ backgroundColor: 'blue' })
          .asElement('button');
      `;

      const result = parseExtendsReference(code, 'PrimaryButton');

      expect(result).toEqual({
        parentName: 'Button',
        isImported: false,
      });
    });

    it('should detect imported parent across quantum entanglement', () => {
      const code = `
        import { Button } from './Button';

        const PrimaryButton = Button.extend()
          .styles({ backgroundColor: 'blue' })
          .asElement('button');
      `;

      const result = parseExtendsReference(code, 'PrimaryButton');

      expect(result).toEqual({
        parentName: 'Button',
        isImported: true,
        importPath: './Button',
      });
    });

    it('should return null for non-extended quantum states', () => {
      const code = `
        const Button = animus
          .styles({ padding: '8px 16px' })
          .asElement('button');
      `;

      const result = parseExtendsReference(code, 'Button');
      expect(result).toBe(null);
    });

    it('should handle complex quantum extension patterns', () => {
      // Test with edge case generators
      const files = EdgeCaseGenerators.deepInheritance(3);
      const level2Code = files['Level2.tsx'];

      const result = parseExtendsReference(level2Code, 'Level2');

      expect(result).toEqual({
        parentName: 'Level1',
        isImported: true,
        importPath: './Level1',
      });
    });
  });

  describe('Reference Extraction: Quantum Observations', () => {
    it('should find JSX component usage in quantum reality', () => {
      const code = `
        function App() {
          return (
            <div>
              <Button variant="primary">Click me</Button>
              <Card title="Hello">Content</Card>
            </div>
          );
        }
      `;

      const refs = extractComponentReferences(code);

      expect(refs).toContainEqual({
        name: 'Button',
        location: expect.objectContaining({
          line: expect.any(Number),
          column: expect.any(Number),
        }),
        isJSX: true,
      });

      expect(refs).toContainEqual({
        name: 'Card',
        location: expect.objectContaining({
          line: expect.any(Number),
          column: expect.any(Number),
        }),
        isJSX: true,
      });
    });

    it('should find function call usage across quantum states', () => {
      const code = `
        const element = Button({ children: 'Click me' });
        const card = Card({ title: 'Hello' });
      `;

      const refs = extractComponentReferences(code);

      expect(refs).toContainEqual({
        name: 'Button',
        location: expect.objectContaining({
          line: expect.any(Number),
          column: expect.any(Number),
        }),
        isJSX: false,
      });

      expect(refs).toContainEqual({
        name: 'Card',
        location: expect.objectContaining({
          line: expect.any(Number),
          column: expect.any(Number),
        }),
        isJSX: false,
      });
    });

    it('should ignore native elements in quantum space', () => {
      const code = `
        function App() {
          return (
            <div>
              <button>Native</button>
              <Button>Component</Button>
            </div>
          );
        }
      `;

      const refs = extractComponentReferences(code);

      // Reality check: extractComponentReferences finds ALL PascalCase identifiers
      // This includes function names like 'App' and component references like 'Button'
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.name)).toEqual(['App', 'Button']);
    });

    it('should handle quantum superposition of component usage', () => {
      // Test with complex prop spreading scenario
      const code = EdgeCaseGenerators.propSpreading();

      const refs = extractComponentReferences(code);

      // Should find all Button references despite complex usage
      const buttonRefs = refs.filter((r) => r.name === 'Button');
      expect(buttonRefs).toHaveLength(3);
      expect(buttonRefs.every((r) => r.isJSX)).toBe(true);
    });
  });

  describe('Quantum Edge Cases', () => {
    it('should handle circular dependency quantum entanglement', () => {
      const circularFiles = EdgeCaseGenerators.circularDependencies(3);

      // Each file should be able to create valid identities
      Object.entries(circularFiles).forEach(([filename, _content]) => {
        const componentName = filename.replace('.tsx', '');
        const identity = createComponentIdentity(
          componentName,
          `/src/${filename}`,
          componentName
        );

        expect(identity.hash).toHaveLength(8);
        expect(identity.name).toBe(componentName);
      });
    });

    it('should maintain identity across name collision realities', () => {
      // Generate collision scenario but we only need to test the identity logic
      EdgeCaseGenerators.nameCollisions();

      // Create identities for all Button variants
      const componentsButton = createComponentIdentity(
        'Button',
        '/components/Button.tsx',
        'Button'
      );
      const uiButton = createComponentIdentity(
        'Button',
        '/ui/Button.tsx',
        'Button'
      );
      const sharedButton = createComponentIdentity(
        'Button',
        '/shared/Button.tsx',
        'SharedButton' // Note: different export name
      );

      // All should have different hashes
      expect(componentsButton.hash).not.toBe(uiButton.hash);
      expect(componentsButton.hash).not.toBe(sharedButton.hash);
      expect(uiButton.hash).not.toBe(sharedButton.hash);

      // But same identity should match itself
      const duplicate = createComponentIdentity(
        'Button',
        '/components/Button.tsx',
        'Button'
      );
      expect(isSameComponent(componentsButton, duplicate)).toBe(true);
    });
  });
});
