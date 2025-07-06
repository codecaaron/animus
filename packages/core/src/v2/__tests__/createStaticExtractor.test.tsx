import * as fs from 'fs';

import * as ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStaticExtractor } from '../index';

// Mock fs module
vi.mock('fs');

describe('createStaticExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract atomic classes from a simple component', () => {
    // Create a minimal test file content
    const testCode = `
      import { animus } from '@animus-ui/core';

      const Button = animus
        .styles({
          backgroundColor: 'blue',
          color: 'white',
          padding: '10px'
        })
        .groups({ space: true })
        .asElement('button');

       const RedButton = Button
          .extend()
          .styles({
            backgroundColor: 'red',
            color: 'black',
            padding: '20px'
          })
          .asElement('button');



       const AnotherThing = () => {
        return <Button p={2} bg="red" color="black">Hello</Button>;
      }
      export { Button, RedButton, AnotherThing };
    `;

    // Create a temporary test file
    const testFileName = '/tmp/test-button.tsx';

    // Mock TypeScript sys methods
    const originalReadFile = ts.sys.readFile;
    const originalFileExists = ts.sys.fileExists;

    ts.sys.readFile = (path: string) => {
      if (path === testFileName) return testCode;
      return originalReadFile(path);
    };

    ts.sys.fileExists = (path: string) => {
      if (path === testFileName) return true;
      return originalFileExists(path);
    };

    try {
      // Create extractor with monitoring and debug logging
      const extractor = createStaticExtractor({
        monitoring: true,
        logLevel: 'debug',
      });

      // Extract from the test file
      const result = extractor.extractFile(testFileName);

      // Check that we found the components
      expect(result.components).toHaveLength(2);

      // Check the first component (Button)
      const button = result.components.find(
        (c) => c.componentId === '5b57a4127d80767e'
      );
      expect(button).toBeDefined();

      // Check that component class is generated
      expect(button!.componentClass).toBeDefined();
      expect(button!.componentClass.className).toMatch(
        /^animus-\w+-[a-f0-9]+$/
      );

      // Check that base styles were extracted
      expect(button!.componentClass.baseStyles.properties.size).toBe(3);
      expect(
        button!.componentClass.baseStyles.properties.get('backgroundColor')
      ).toEqual({
        name: 'backgroundColor',
        value: 'blue',
        source: expect.any(String),
        confidence: 1.0,
      });

      // Debug: log what we got
      console.log(
        'Button extraction result:',
        JSON.stringify(
          {
            componentClass: button!.componentClass.className,
            baseStylesCount: button!.componentClass.baseStyles.properties.size,
            atomicClassesCount: button!.atomicClasses.required.length,
            atomicClasses: button!.atomicClasses.required,
          },
          null,
          2
        )
      );

      // Check that atomic classes are generated from JSX props
      // The test component usage includes p={2}, bg="red", color="black"
      expect(button!.atomicClasses.required.length).toBe(3);

      // Check for specific atomic classes
      expect(button!.atomicClasses.required).toContainEqual(
        expect.objectContaining({
          className: 'animus-p-2',
          property: 'padding',
          value: '2',
        })
      );

      expect(button!.atomicClasses.required).toContainEqual(
        expect.objectContaining({
          className: 'animus-bg-red',
          property: 'background-color',
          value: 'red',
        })
      );

      expect(button!.atomicClasses.required).toContainEqual(
        expect.objectContaining({
          className: 'animus-color-black',
          property: 'color',
          value: 'black',
        })
      );

      // Create a snapshot of the extraction result
      expect({
        fileName: result.fileName,
        components: result.components,
        errorCount: result.errors.length,
        hasPerformanceData: !!result.performance,
      }).toMatchSnapshot();
    } finally {
      // Restore original methods
      ts.sys.readFile = originalReadFile;
      ts.sys.fileExists = originalFileExists;
    }
  });

  it('should create extractor with default config', () => {
    const extractor = createStaticExtractor();

    expect(extractor.config).toMatchSnapshot();
  });

  it('should handle empty file gracefully', () => {
    const testFileName = '/tmp/empty.tsx';

    // Mock TypeScript sys methods
    const originalReadFile = ts.sys.readFile;
    const originalFileExists = ts.sys.fileExists;

    ts.sys.readFile = (path: string) => {
      if (path === testFileName) return '';
      return originalReadFile(path);
    };

    ts.sys.fileExists = (path: string) => {
      if (path === testFileName) return true;
      return originalFileExists(path);
    };

    try {
      const extractor = createStaticExtractor({ monitoring: false });
      const result = extractor.extractFile(testFileName);

      expect({
        fileName: result.fileName,
        componentCount: result.components.length,
        hasErrors: result.errors.length > 0,
      }).toMatchSnapshot();
    } finally {
      ts.sys.readFile = originalReadFile;
      ts.sys.fileExists = originalFileExists;
    }
  });
});
