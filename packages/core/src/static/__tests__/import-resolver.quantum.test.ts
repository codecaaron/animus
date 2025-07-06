import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createComponentIdentity } from '../component-identity';
import { ImportResolver } from '../import-resolver';
import { createTestUniverse, TestUniverse } from './test-utils';

describe('[QUANTUM] Import Resolver - Tracing Paths Across the Void', () => {
  let universe: TestUniverse;

  beforeEach(() => {
    universe = createTestUniverse('import-resolver');
  });

  afterEach(() => {
    if (universe) {
      universe.cleanup();
    }
  });

  describe('Import Extraction', () => {
    it('should extract default imports', () => {
      // Create quantum component with default export
      universe.createFile(
        'Button.tsx',
        `
        import { animus } from '@animus/core';

        const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
        
        export default Button;
      `
      );

      // Create file that imports it
      const appPath = universe.createFile(
        'App.tsx',
        `
        import Button from './Button';

        export function App() {
          return <Button>Click me</Button>;
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Fix: resolveImport takes (componentName, fromFile)
      const identity = resolver.resolveImport('Button', appPath);

      expect(identity).toBeDefined();
      expect(identity?.name).toBe('Button');
      expect(identity?.exportName).toBe('default');
    });

    it('should extract named imports', () => {
      // Create quantum component manifold
      universe.createFile(
        'components.tsx',
        `
        import { animus } from '@animus/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
        export const Card = animus
          .styles({ border: '1px solid gray' })
          .asElement('div');
      `
      );

      // Create file that imports from manifold
      const appPath = universe.createFile(
        'App.tsx',
        `
        import { Button, Card } from './components';
        export function App() {
          return <Card><Button>Click</Button></Card>;
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Resolve Button import
      const buttonIdentity = resolver.resolveImport('Button', appPath);
      expect(buttonIdentity).toBeDefined();
      expect(buttonIdentity?.name).toBe('Button');
      expect(buttonIdentity?.exportName).toBe('Button');

      // Resolve Card import
      const cardIdentity = resolver.resolveImport('Card', appPath);
      expect(cardIdentity).toBeDefined();
      expect(cardIdentity?.name).toBe('Card');
      expect(cardIdentity?.exportName).toBe('Card');
    });

    it('should handle aliased imports', () => {
      // Create component with different export name
      universe.createFile(
        'Button.tsx',
        `
        import { animus } from '@animus/core';
        const MyButton = animus
          .styles({ padding: '8px' })
          .asElement('button');
        export { MyButton as Button };
      `
      );

      // Import with alias
      const appPath = universe.createFile(
        'App.tsx',
        `
        import { Button as PrimaryButton } from './Button';
        export function App() {
          return <PrimaryButton>Click me</PrimaryButton>;
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Resolve aliased import
      const identity = resolver.resolveImport('PrimaryButton', appPath);
      expect(identity).toBeDefined();
      expect(identity?.name).toBe('MyButton');
      expect(identity?.exportName).toBe('Button');
    });

    it('should resolve components from subdirectories', () => {
      // Create nested component
      universe.createFile(
        'components/ui/Button.tsx',
        `
        import { animus } from '@animus/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `
      );

      // Import from subdirectory
      const appPath = universe.createFile(
        'App.tsx',
        `
        import { Button } from './components/ui/Button';
        export function App() {
          return <Button>Click me</Button>;
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      const identity = resolver.resolveImport('Button', appPath);
      expect(identity).toBeDefined();
      expect(identity?.name).toBe('Button');
      expect(identity?.filePath).toContain('components/ui/Button.tsx');
    });
  });

  describe('Export Tracking', () => {
    it('should track re-exports', () => {
      // Create base component
      universe.createFile(
        'base/Button.tsx',
        `
        import { animus } from '@animus/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `
      );

      // Create re-export file
      universe.createFile(
        'components/index.tsx',
        `
        export { Button } from '../base/Button';
        export { Button as DefaultButton } from '../base/Button';
      `
      );

      // Import from re-export
      const appPath = universe.createFile(
        'App.tsx',
        `
        import { Button, DefaultButton } from './components';
        export function App() {
          return <><Button /><DefaultButton /></>;
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Both should resolve to the same component
      const buttonIdentity = resolver.resolveImport('Button', appPath);
      const defaultIdentity = resolver.resolveImport('DefaultButton', appPath);

      expect(buttonIdentity).toBeDefined();
      expect(defaultIdentity).toBeDefined();
      // Both should point to the same original component
      expect(buttonIdentity?.name).toBe('Button');
      expect(defaultIdentity?.name).toBe('Button');
    });

    it('should handle mixed exports', () => {
      // Create file with mixed exports
      universe.createFile(
        'components.tsx',
        `
        import { animus } from '@animus/core';
        
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
        
        const Card = animus
          .styles({ border: '1px solid' })
          .asElement('div');
        
        export default Card;
        export { Card as CardComponent };
      `
      );

      const appPath = universe.createFile(
        'App.tsx',
        `
        import DefaultCard, { Button, CardComponent } from './components';
        export function App() {
          return (
            <DefaultCard>
              <Button>Click</Button>
              <CardComponent>Content</CardComponent>
            </DefaultCard>
          );
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Resolve all imports
      const buttonIdentity = resolver.resolveImport('Button', appPath);
      const defaultCardIdentity = resolver.resolveImport(
        'DefaultCard',
        appPath
      );
      const cardComponentIdentity = resolver.resolveImport(
        'CardComponent',
        appPath
      );

      expect(buttonIdentity).toBeDefined();
      expect(buttonIdentity?.name).toBe('Button');

      expect(defaultCardIdentity).toBeDefined();
      expect(cardComponentIdentity).toBeDefined();
      // Both should resolve to the same Card component
      expect(defaultCardIdentity?.name).toBe('Card');
      expect(cardComponentIdentity?.name).toBe('Card');
    });
  });

  describe('Component Reference Finding', () => {
    it('should find all files importing a component', () => {
      // Create a component
      const buttonPath = universe.createFile(
        'Button.tsx',
        `
        import { animus } from '@animus/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `
      );

      // Create multiple files that import it
      universe.createFile(
        'Header.tsx',
        `
        import { Button } from './Button';
        export const Header = () => <Button>Logo</Button>;
      `
      );

      universe.createFile(
        'Footer.tsx',
        `
        import { Button } from './Button';
        export const Footer = () => <Button>Contact</Button>;
      `
      );

      universe.createFile(
        'Sidebar.tsx',
        `
        import { Button } from './Button';
        export const Sidebar = () => <Button>Menu</Button>;
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Get Button's identity
      const buttonIdentity = createComponentIdentity(
        'Button',
        buttonPath,
        'Button'
      );

      // Find all references
      const references = resolver.findComponentReferences(buttonIdentity);

      expect(references.size).toBe(3);
      expect(Array.from(references).some((f) => f.includes('Header.tsx'))).toBe(
        true
      );
      expect(Array.from(references).some((f) => f.includes('Footer.tsx'))).toBe(
        true
      );
      expect(
        Array.from(references).some((f) => f.includes('Sidebar.tsx'))
      ).toBe(true);
    });
  });

  describe('Dependency Graph', () => {
    it('should build complete dependency graph', () => {
      // Create a complex dependency structure
      universe.createFile(
        'theme.ts',
        `export const theme = { colors: { primary: 'blue' } };`
      );

      universe.createFile(
        'base/Button.tsx',
        `
        import { animus } from '@animus/core';
        import { theme } from '../theme';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      universe.createFile(
        'components/Card.tsx',
        `
        import { animus } from '@animus/core';
        import { theme } from '../theme';
        export const Card = animus.styles({}).asElement('div');
      `
      );

      universe.createFile(
        'App.tsx',
        `
        import { Button } from './base/Button';
        import { Card } from './components/Card';
        export const App = () => <Card><Button /></Card>;
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      const graph = resolver.buildDependencyGraph();

      // Check that graph contains expected dependencies
      expect(graph.size).toBeGreaterThan(0);

      // App depends on Button and Card
      const appDeps = Array.from(graph.entries()).find(([file]) =>
        file.includes('App.tsx')
      );
      expect(appDeps).toBeDefined();
      if (appDeps) {
        const [, deps] = appDeps;
        expect(deps.size).toBe(2);
        expect(Array.from(deps).some((d) => d.includes('Button.tsx'))).toBe(
          true
        );
        expect(Array.from(deps).some((d) => d.includes('Card.tsx'))).toBe(true);
      }

      // Button and Card depend on theme
      const buttonDeps = Array.from(graph.entries()).find(([file]) =>
        file.includes('Button.tsx')
      );
      if (buttonDeps) {
        const [, deps] = buttonDeps;
        expect(Array.from(deps).some((d) => d.includes('theme.ts'))).toBe(true);
      }
    });
  });

  describe('Local Components', () => {
    it('should resolve components defined and used in same file', () => {
      const appPath = universe.createFile(
        'App.tsx',
        `
        import { animus } from '@animus/core';
        
        const LocalButton = animus
          .styles({ padding: '8px' })
          .asElement('button');
        
        export const LocalCard = animus
          .styles({ border: '1px solid' })
          .asElement('div');
        
        export function App() {
          return (
            <LocalCard>
              <LocalButton>Click me</LocalButton>
            </LocalCard>
          );
        }
      `
      );

      const program = universe.createProgram();
      const resolver = new ImportResolver(program);

      // Resolve local exported component
      const cardIdentity = resolver.resolveImport('LocalCard', appPath);
      expect(cardIdentity).toBeDefined();
      expect(cardIdentity?.name).toBe('LocalCard');
      expect(cardIdentity?.filePath).toBe(appPath);

      // Non-exported local components won't be resolved through imports
      const buttonIdentity = resolver.resolveImport('LocalButton', appPath);
      expect(buttonIdentity).toBeUndefined();
    });
  });
});
