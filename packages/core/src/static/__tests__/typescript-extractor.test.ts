import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TypeScriptExtractor } from '../typescript-extractor';

describe('TypeScript Extractor - First Span Across the ABYSS', () => {
  let extractor: TypeScriptExtractor;
  let tempDir: string;

  beforeEach(() => {
    extractor = new TypeScriptExtractor();
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestFile = (filename: string, content: string) => {
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  const createTsConfig = () => {
    const tsconfig = {
      compilerOptions: {
        target: 'es2020',
        module: 'commonjs',
        jsx: 'react',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );
  };

  describe('Single File Extraction', () => {
    it('should extract styles from a single file', () => {
      const buttonFile = createTestFile(
        'Button.ts',
        `
        import { animus } from '@animus-ui/core';
        
        export const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white'
          })
          .asElement('button');
      `
      );

      const result = extractor.extractFromFile(buttonFile);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        componentName: 'Button',
        baseStyles: {
          padding: '8px 16px',
          backgroundColor: 'blue',
          color: 'white',
        },
        identity: {
          name: 'Button',
          filePath: buttonFile,
          exportName: 'Button',
        },
      });
    });

    it('should handle default exports', () => {
      const cardFile = createTestFile(
        'Card.ts',
        `
        import { animus } from '@animus-ui/core';
        
        const Card = animus
          .styles({
            padding: '16px',
            borderRadius: '8px'
          })
          .asElement('div');
          
        export default Card;
      `
      );

      const result = extractor.extractFromFile(cardFile);

      expect(result).toHaveLength(1);
      expect(result[0].identity.exportName).toBe('default');
    });
  });

  describe('Program-Wide Extraction', () => {
    it('should extract from all files in a program', () => {
      createTsConfig();

      createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `
      );

      createTestFile(
        'Card.tsx',
        `
        import { animus } from '@animus-ui/core';
        
        export const Card = animus
          .styles({ borderRadius: '4px' })
          .asElement('div');
      `
      );

      createTestFile(
        'Layout.tsx',
        `
        import { animus } from '@animus-ui/core';
        
        export const Layout = animus
          .styles({ display: 'grid' })
          .asElement('div');
      `
      );

      extractor.initializeProgram(tempDir);
      const results = extractor.extractFromProgram();

      expect(results).toHaveLength(3);

      const componentNames = results.map((r) => r.componentName).sort();
      expect(componentNames).toEqual(['Button', 'Card', 'Layout']);

      // Each should have its identity
      results.forEach((result) => {
        expect(result.identity.filePath).toContain(tempDir);
        expect(result.identity.exportName).toBe(result.componentName);
        expect(result.identity.hash).toBeDefined();
      });
    });

    it('should skip node_modules and declaration files', () => {
      createTsConfig();

      // Create a fake node_modules component (should be skipped)
      const nodeModulesDir = path.join(tempDir, 'node_modules', 'some-lib');
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      createTestFile(
        'node_modules/some-lib/index.js',
        `
        export const LibComponent = animus.styles({}).asElement('div');
      `
      );

      // Create a declaration file (should be skipped)
      createTestFile(
        'types.d.ts',
        `
        declare const Something: any;
      `
      );

      // Create actual component
      createTestFile(
        'MyComponent.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const MyComponent = animus.styles({ color: 'red' }).asElement('span');
      `
      );

      extractor.initializeProgram(tempDir);
      const results = extractor.extractFromProgram();

      // Should only find MyComponent
      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('MyComponent');
    });
  });

  describe('Component File Detection', () => {
    it('should identify files containing animus components', () => {
      createTsConfig();

      createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      createTestFile(
        'utils.ts',
        `
        export function helper() { return 42; }
      `
      );

      createTestFile(
        'Card.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Card = animus.variant({ prop: 'size' }).asElement('div');
      `
      );

      extractor.initializeProgram(tempDir);
      const componentFiles = extractor.getComponentFiles();

      expect(componentFiles).toHaveLength(2);
      expect(componentFiles.some((f) => f.includes('Button.tsx'))).toBe(true);
      expect(componentFiles.some((f) => f.includes('Card.tsx'))).toBe(true);
      expect(componentFiles.some((f) => f.includes('utils.ts'))).toBe(false);
    });
  });

  describe('Export Name Resolution', () => {
    it('should handle various export patterns', () => {
      const complexFile = createTestFile(
        'Complex.tsx',
        `
        import { animus } from '@animus-ui/core';
        
        // Named export
        export const Button = animus.styles({ padding: '8px' }).asElement('button');
        
        // Variable then export
        const Card = animus.styles({ border: '1px solid' }).asElement('div');
        export { Card };
        
        // Renamed export
        const InternalLayout = animus.styles({ display: 'grid' }).asElement('div');
        export { InternalLayout as Layout };
      `
      );

      const results = extractor.extractFromFile(complexFile);

      expect(results).toHaveLength(3);

      const button = results.find((r) => r.componentName === 'Button');
      expect(button?.identity.exportName).toBe('Button');

      const card = results.find((r) => r.componentName === 'Card');
      expect(card?.identity.exportName).toBe('Card');

      // Note: renamed exports require more complex resolution
      // This is a limitation of our current approach
      const layout = results.find((r) => r.componentName === 'InternalLayout');
      expect(layout?.identity.exportName).toBe('unknown'); // For now
    });
  });
});

// The tests validate our first quantum leap
// The TypeScript Program now sees all, knows all
