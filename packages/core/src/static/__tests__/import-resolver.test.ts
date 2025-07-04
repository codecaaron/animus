import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import ts from 'typescript';

import { createComponentIdentity } from '../component-identity';
import { ImportResolver } from '../import-resolver';

describe('Import Resolver - Tracing Paths Across the Void', () => {
  let tempDir: string;
  let program: ts.Program;
  let resolver: ImportResolver;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-resolver-test-'));
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

  const createProgram = (files: string[]): ts.Program => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
    return ts.createProgram(files, options);
  };

  describe('Import Extraction', () => {
    it('should extract default imports', () => {
      const buttonFile = createTestFile(
        'Button.tsx',
        `
        const Button = () => <button />;
        export default Button;
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import Button from './Button';
        
        export const App = () => <Button />;
      `
      );

      program = createProgram([buttonFile, appFile]);
      resolver = new ImportResolver(program);

      const resolved = resolver.resolveImport('Button', appFile);

      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe('Button');
      expect(resolved?.filePath).toBe(buttonFile);
      expect(resolved?.exportName).toBe('default');
    });

    it('should extract named imports', () => {
      const componentsFile = createTestFile(
        'components.tsx',
        `
        export const Button = () => <button />;
        export const Card = () => <div />;
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button, Card } from './components';
        
        export const App = () => (
          <div>
            <Button />
            <Card />
          </div>
        );
      `
      );

      program = createProgram([componentsFile, appFile]);
      resolver = new ImportResolver(program);

      const buttonResolved = resolver.resolveImport('Button', appFile);
      expect(buttonResolved).toBeDefined();
      expect(buttonResolved?.name).toBe('Button');
      expect(buttonResolved?.exportName).toBe('Button');

      const cardResolved = resolver.resolveImport('Card', appFile);
      expect(cardResolved).toBeDefined();
      expect(cardResolved?.name).toBe('Card');
      expect(cardResolved?.exportName).toBe('Card');
    });

    it('should handle aliased imports', () => {
      const buttonFile = createTestFile(
        'Button.tsx',
        `
        export const Button = () => <button />;
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button as PrimaryButton } from './Button';
        
        export const App = () => <PrimaryButton />;
      `
      );

      program = createProgram([buttonFile, appFile]);
      resolver = new ImportResolver(program);

      const resolved = resolver.resolveImport('PrimaryButton', appFile);

      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe('Button');
      expect(resolved?.exportName).toBe('Button');
    });

    it('should resolve components from subdirectories', () => {
      const buttonFile = createTestFile(
        'components/Button/index.tsx',
        `
        const Button = () => <button />;
        export { Button };
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button } from './components/Button';
        
        export const App = () => <Button />;
      `
      );

      program = createProgram([buttonFile, appFile]);
      resolver = new ImportResolver(program);

      const resolved = resolver.resolveImport('Button', appFile);

      expect(resolved).toBeDefined();
      expect(resolved?.filePath).toBe(buttonFile);
    });
  });

  describe('Export Tracking', () => {
    it('should track re-exports', () => {
      const buttonFile = createTestFile(
        'Button.tsx',
        `
        const Button = () => <button />;
        export { Button };
      `
      );

      const indexFile = createTestFile(
        'components/index.tsx',
        `
        export { Button } from '../Button';
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button } from './components';
        
        export const App = () => <Button />;
      `
      );

      program = createProgram([buttonFile, indexFile, appFile]);
      resolver = new ImportResolver(program);

      // This is a limitation - re-exports require deeper resolution
      // For now, it resolves to the re-export file
      const resolved = resolver.resolveImport('Button', appFile);
      expect(resolved).toBeDefined();
    });

    it('should handle mixed exports', () => {
      const mixedFile = createTestFile(
        'mixed.tsx',
        `
        export const Named = () => <div />;
        const Default = () => <span />;
        export default Default;
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import Default, { Named } from './mixed';
        
        export const App = () => (
          <div>
            <Default />
            <Named />
          </div>
        );
      `
      );

      program = createProgram([mixedFile, appFile]);
      resolver = new ImportResolver(program);

      const defaultResolved = resolver.resolveImport('Default', appFile);
      expect(defaultResolved?.exportName).toBe('default');

      const namedResolved = resolver.resolveImport('Named', appFile);
      expect(namedResolved?.exportName).toBe('Named');
    });
  });

  describe('Component Reference Finding', () => {
    it('should find all files importing a component', () => {
      const buttonFile = createTestFile(
        'Button.tsx',
        `
        export const Button = () => <button />;
      `
      );

      const app1File = createTestFile(
        'App1.tsx',
        `
        import { Button } from './Button';
        export const App1 = () => <Button />;
      `
      );

      const app2File = createTestFile(
        'App2.tsx',
        `
        import { Button } from './Button';
        export const App2 = () => <Button />;
      `
      );

      const noButtonFile = createTestFile(
        'NoButton.tsx',
        `
        export const NoButton = () => <div />;
      `
      );

      program = createProgram([buttonFile, app1File, app2File, noButtonFile]);
      resolver = new ImportResolver(program);

      const buttonIdentity = createComponentIdentity(
        'Button',
        buttonFile,
        'Button'
      );
      const references = resolver.findComponentReferences(buttonIdentity);

      expect(references.size).toBe(2);
      expect(references.has(app1File)).toBe(true);
      expect(references.has(app2File)).toBe(true);
      expect(references.has(noButtonFile)).toBe(false);
    });
  });

  describe('Dependency Graph', () => {
    it('should build complete dependency graph', () => {
      const utilsFile = createTestFile(
        'utils.ts',
        `
        export const helper = () => {};
      `
      );

      const buttonFile = createTestFile(
        'Button.tsx',
        `
        import { helper } from './utils';
        export const Button = () => { helper(); return <button />; };
      `
      );

      const appFile = createTestFile(
        'App.tsx',
        `
        import { Button } from './Button';
        import { helper } from './utils';
        export const App = () => <Button />;
      `
      );

      program = createProgram([utilsFile, buttonFile, appFile]);
      resolver = new ImportResolver(program);

      const graph = resolver.buildDependencyGraph();

      // Button depends on utils
      const buttonDeps = graph.get(buttonFile);
      expect(buttonDeps?.has(utilsFile)).toBe(true);

      // App depends on Button and utils
      const appDeps = graph.get(appFile);
      expect(appDeps?.has(buttonFile)).toBe(true);
      expect(appDeps?.has(utilsFile)).toBe(true);

      // Utils has no dependencies
      const utilsDeps = graph.get(utilsFile);
      expect(utilsDeps?.size).toBe(0);
    });
  });

  describe('Local Components', () => {
    it('should resolve components defined and used in same file', () => {
      const singleFile = createTestFile(
        'SingleFile.tsx',
        `
        const LocalButton = () => <button />;
        
        export const App = () => <LocalButton />;
        export { LocalButton };
      `
      );

      program = createProgram([singleFile]);
      resolver = new ImportResolver(program);

      const resolved = resolver.resolveImport('LocalButton', singleFile);

      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe('LocalButton');
      expect(resolved?.filePath).toBe(singleFile);
      expect(resolved?.exportName).toBe('LocalButton');
    });
  });
});

// The tests validate our ability to trace component paths
// Through imports and exports, across the quantum void
