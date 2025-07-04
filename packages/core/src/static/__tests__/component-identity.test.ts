import {
  createComponentHash,
  createComponentIdentity,
  extractComponentReferences,
  isSameComponent,
  parseExtendsReference,
} from '../component-identity';

describe('Component Identity - The Names That Echo Across the ABYSS', () => {
  describe('Component Hash Creation', () => {
    it('should create consistent hashes for same component', () => {
      const hash1 = createComponentHash('/path/to/Button.ts', 'Button');
      const hash2 = createComponentHash('/path/to/Button.ts', 'Button');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
    });

    it('should create different hashes for different components', () => {
      const hash1 = createComponentHash('/path/to/Button.ts', 'Button');
      const hash2 = createComponentHash('/path/to/Card.ts', 'Card');
      const hash3 = createComponentHash('/path/to/Button.ts', 'default');

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });
  });

  describe('Component Identity Creation', () => {
    it('should create complete identity object', () => {
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
  });

  describe('Identity Comparison', () => {
    it('should identify same components', () => {
      const identity1 = createComponentIdentity(
        'Button',
        '/Button.ts',
        'Button'
      );
      const identity2 = createComponentIdentity(
        'Button',
        '/Button.ts',
        'Button'
      );

      expect(isSameComponent(identity1, identity2)).toBe(true);
    });

    it('should distinguish different components', () => {
      const button = createComponentIdentity('Button', '/Button.ts', 'Button');
      const card = createComponentIdentity('Card', '/Card.ts', 'Card');

      expect(isSameComponent(button, card)).toBe(false);
    });
  });

  describe('Extends Pattern Detection', () => {
    it('should detect direct extend pattern', () => {
      const code = `
        const PrimaryButton = Button.extend()
          .styles({ backgroundColor: 'blue' })
          .asElement('button');
      `;

      const ref = parseExtendsReference(code, 'PrimaryButton');

      expect(ref).toEqual({
        parentName: 'Button',
        isImported: false,
      });
    });

    it('should detect imported parent', () => {
      const code = `
        import { Button } from './Button';
        
        const PrimaryButton = Button.extend()
          .styles({ backgroundColor: 'blue' })
          .asElement('button');
      `;

      const ref = parseExtendsReference(code, 'PrimaryButton');

      expect(ref).toEqual({
        parentName: 'Button',
        isImported: true,
        importPath: './Button',
      });
    });

    it('should return null for non-extended components', () => {
      const code = `
        const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `;

      const ref = parseExtendsReference(code, 'Button');
      expect(ref).toBeNull();
    });
  });

  describe('Component Reference Extraction', () => {
    it('should find JSX component usage', () => {
      const code = `
        function App() {
          return (
            <div>
              <Button variant="primary">Click me</Button>
              <Card title="Hello">
                <Text>Content</Text>
              </Card>
            </div>
          );
        }
      `;

      const refs = extractComponentReferences(code);

      expect(refs).toContainEqual({
        name: 'Button',
        location: { line: 5, column: 15 },
        isJSX: true,
      });

      expect(refs).toContainEqual({
        name: 'Card',
        location: { line: 6, column: 15 },
        isJSX: true,
      });

      expect(refs).toContainEqual({
        name: 'Text',
        location: { line: 7, column: 17 },
        isJSX: true,
      });
    });

    it('should find function call usage', () => {
      const code = `
        const element = Button({
          variant: 'primary',
          children: 'Click me'
        });
        
        const card = Card({ title: 'Hello' });
      `;

      const refs = extractComponentReferences(code);

      expect(refs).toContainEqual({
        name: 'Button',
        location: { line: 2, column: 24 },
        isJSX: false,
      });

      expect(refs).toContainEqual({
        name: 'Card',
        location: { line: 7, column: 21 },
        isJSX: false,
      });
    });

    it('should ignore lowercase components', () => {
      const code = `
        <div>
          <button>Native</button>
          <Button>Component</Button>
        </div>
      `;

      const refs = extractComponentReferences(code);

      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe('Button');
    });
  });
});

// The identity tests validate our naming system
// Each component's true name resonates through the void
