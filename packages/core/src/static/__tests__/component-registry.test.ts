import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import ts from 'typescript';

import { createComponentIdentity } from '../component-identity';
import { ComponentRegistry } from '../component-registry';

describe('Component Registry - The Central Authority', () => {
  let tempDir: string;
  let program: ts.Program;
  let registry: ComponentRegistry;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestFile = (filename: string, content: string): string => {
    const filePath = path.join(tempDir, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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

  const createProgram = (files: string[]): ts.Program => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
    return ts.createProgram(files, options);
  };

  describe('Registry Initialization', () => {
    it('should initialize with components from all files', async () => {
      createTsConfig();

      const buttonFile = createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';

        export const Button = animus
          .styles({ padding: '8px 16px' })
          .asElement('button');
      `
      );

      const cardFile = createTestFile(
        'Card.tsx',
        `
        import { animus } from '@animus-ui/core';

        export const Card = animus
          .styles({ borderRadius: '8px' })
          .asElement('div');
      `
      );

      program = createProgram([buttonFile, cardFile]);
      registry = new ComponentRegistry(program);

      await registry.initialize();

      const allComponents = registry.getAllComponents();
      expect(allComponents).toHaveLength(2);

      const componentNames = allComponents.map((c) => c.identity.name).sort();
      expect(componentNames).toEqual(['Button', 'Card']);
    });

    it('should handle multiple components in same file', async () => {
      createTsConfig();

      const componentsFile = createTestFile(
        'components.tsx',
        `
        import { animus } from '@animus-ui/core';

        export const Button = animus
          .styles({ padding: '8px 16px' })
          .asElement('button');

        export const Card = animus
          .styles({ borderRadius: '8px' })
          .asElement('div');
      `
      );

      program = createProgram([componentsFile]);
      registry = new ComponentRegistry(program);

      await registry.initialize();

      const fileComponents = registry.getFileComponents(componentsFile);
      expect(fileComponents).toHaveLength(2);

      const names = fileComponents.map((c) => c.identity.name).sort();
      expect(names).toEqual(['Button', 'Card']);
    });
  });

  describe('Component Retrieval', () => {
    beforeEach(async () => {
      createTsConfig();

      const button = createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      const card = createTestFile(
        'components/Card.tsx',
        `
      import { animus } from '@animus-ui/core';
        export const Card = animus.styles({}).asElement('div');
      `
      );

      program = createProgram([button, card]);
      registry = new ComponentRegistry(program);
      await registry.initialize();
    });

    it('should get component by identity', () => {
      const buttonIdentity = createComponentIdentity(
        'Button',
        path.join(tempDir, 'Button.tsx'),
        'Button'
      );

      const button = registry.getComponent(buttonIdentity);
      expect(button).toBeDefined();
      expect(button?.identity.name).toBe('Button');
    });

    it('should get components from specific file', () => {
      const cardFile = path.join(tempDir, 'components/Card.tsx');
      const fileComponents = registry.getFileComponents(cardFile);

      expect(fileComponents).toHaveLength(1);
      expect(fileComponents[0].identity.name).toBe('Card');
    });
  });

  describe('Usage Tracking', () => {
    it('should track component usage across files', async () => {
      createTsConfig();

      const buttonFile = createTestFile(
        'Button.tsx',
        `
                import { animus } from '@animus-ui/core';
        export const Button = animus
          .groups({ space: true })
          .asElement('button');
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button } from './Button';

        export const App = () => (
          <>
            <Button p={4}>Click me</Button>
            <Button p={6} m={2}>Another</Button>
          </>
        );
      `
      );

      program = createProgram([buttonFile, appFile]);
      registry = new ComponentRegistry(program);
      await registry.initialize();

      const buttonIdentity = createComponentIdentity(
        'Button',
        buttonFile,
        'Button'
      );
      const usage = registry.getComponentUsage(buttonIdentity);

      expect(usage.Button).toBeDefined();
      expect(usage.Button.p).toEqual(new Set(['4:_', '6:_']));
      expect(usage.Button.m).toEqual(new Set(['2:_']));
    });

    it('should provide global usage map', async () => {
      createTsConfig();

      const button = createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      const card = createTestFile(
        'Card.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Card = animus.styles({}).asElement('div');
      `
      );

      const app = createTestFile(
        'App.tsx',
        `
        import { Button } from './Button';
        import { Card } from './Card';

        export const App = () => (
          <>
            <Button>Click</Button>
            <Card title="Hello" />
          </>
        );
      `
      );

      program = createProgram([button, card, app]);
      registry = new ComponentRegistry(program);
      await registry.initialize();

      const globalUsage = registry.getGlobalUsage();

      expect(globalUsage.size).toBe(2); // Button and Card

      // Check that both components have usage
      const usageArray = Array.from(globalUsage.values());
      expect(usageArray.every((u) => u.usages.length > 0)).toBe(true);
    });
  });

  describe('File Invalidation', () => {
    it('should reprocess invalidated files', async () => {
      createTsConfig();

      const buttonFile = createTestFile(
        'Button.tsx',
        `
                        import { animus } from '@animus-ui/core';
        export const Button = animus
          .styles({ padding: '8px' })
          .asElement('button');
      `
      );

      program = createProgram([buttonFile]);
      registry = new ComponentRegistry(program);
      await registry.initialize();

      // Get initial component
      let components = registry.getAllComponents();
      expect(components).toHaveLength(1);
      expect(components[0].styles.baseStyles?.padding).toBe('8px');

      // Update the file
      fs.writeFileSync(
        buttonFile,
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus
          .styles({ padding: '16px' })
          .asElement('button');
      `
      );

      // Invalidate and reprocess
      await registry.invalidateFile(buttonFile);

      // Check updated component
      components = registry.getAllComponents();
      expect(components).toHaveLength(1);
      expect(components[0].styles.baseStyles?.padding).toBe('16px');
    });

    it('should emit events on component changes', async () => {
      createTsConfig();

      const events = {
        added: [] as any[],
        updated: [] as any[],
        removed: [] as any[],
        invalidated: [] as string[],
      };

      const buttonFile = createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      program = createProgram([buttonFile]);
      registry = new ComponentRegistry(program);

      // Subscribe to events
      registry.on('componentAdded', (entry) => events.added.push(entry));
      registry.on('componentUpdated', (entry) => events.updated.push(entry));
      registry.on('componentRemoved', (identity) =>
        events.removed.push(identity)
      );
      registry.on('fileInvalidated', (file) => events.invalidated.push(file));

      await registry.initialize();

      expect(events.added).toHaveLength(1);
      expect(events.added[0].identity.name).toBe('Button');

      // Update file
      fs.writeFileSync(
        buttonFile,
        `
       import { animus } from '@animus-ui/core';
        export const NewButton = animus.styles({}).asElement('button');
      `
      );

      await registry.invalidateFile(buttonFile);

      expect(events.removed).toHaveLength(1);
      expect(events.removed[0].name).toBe('Button');

      expect(events.added).toHaveLength(2); // Original + new
      expect(events.invalidated).toContain(buttonFile);
    });
  });

  describe('Dependency Tracking', () => {
    it('should track component dependents', async () => {
      createTsConfig();

      const buttonFile = createTestFile(
        'Button.tsx',
        `
        import { animus } from '@animus-ui/core';
        export const Button = animus.styles({}).asElement('button');
      `
      );

      const app1 = createTestFile(
        'App1.tsx',
        `
        import { Button } from './Button';
        export const App1 = () => <Button />;
      `
      );

      const app2 = createTestFile(
        'App2.tsx',
        `
        import { Button } from './Button';
        export const App2 = () => <Button />;
      `
      );

      program = createProgram([buttonFile, app1, app2]);
      registry = new ComponentRegistry(program);
      await registry.initialize();

      const buttonIdentity = createComponentIdentity(
        'Button',
        buttonFile,
        'Button'
      );
      const buttonEntry = registry.getComponent(buttonIdentity);

      expect(buttonEntry?.dependents.size).toBe(2);
      expect(buttonEntry?.dependents.has(app1)).toBe(true);
      expect(buttonEntry?.dependents.has(app2)).toBe(true);
    });
  });

  describe('Registry Statistics', () => {
    it('should provide accurate statistics', async () => {
      createTsConfig();

      const base = createTestFile(
        'Base.tsx',
        `
                        import { animus } from '@animus-ui/core';
        export const Base = animus.styles({}).asElement('div');
      `
      );

      const extended = createTestFile(
        'Extended.tsx',
        `
        import { Base } from './Base';
        export const Extended = Base.extend().styles({}).asElement('div');
      `
      );

      const unused = createTestFile(
        'Unused.tsx',
        `
                        import { animus } from '@animus-ui/core';
        export const Unused = animus.styles({}).asElement('span');
      `
      );

      const app = createTestFile(
        'App.tsx',
        `
        import { Base } from './Base';
        import { Extended } from './Extended';

        export const App = () => (
          <>
            <Base />
            <Extended />
          </>
        );
      `
      );

      program = createProgram([base, extended, unused, app]);
      registry = new ComponentRegistry(program);
      await registry.initialize();

      const stats = registry.getStats();

      // Only Base and Extended are found because Unused isn't used
      expect(stats.totalComponents).toBeGreaterThanOrEqual(2);
      expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
      expect(stats.componentsWithUsage).toBe(2); // Base and Extended
      expect(stats.componentsWithDependents).toBeGreaterThan(0);
    });
  });
});

// The Registry tests validate our central authority
// All components are tracked, their relationships known
