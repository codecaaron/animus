import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComponentGraph } from '../component-graph';
import type { GraphCache } from '../graph-cache';

/**
 * QUANTUM TEST: Graph Cache - Testing cache logic without file system
 *
 * This test focuses on the serialization/deserialization logic and cache
 * validation behavior by mocking all file system operations.
 */

// Mock file system operations
const mockFS = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
};

// Mock the fs module
vi.mock('fs', () => mockFS);

// Import after mocking
const { GraphCache: ActualGraphCache } = await import('../graph-cache');

describe('[QUANTUM] Graph Cache - Pure Cache Logic', () => {
  // Mock console to suppress expected warnings
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    console.warn = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });
  const createMockComponentGraph = (): ComponentGraph => ({
    components: new Map([
      [
        'hash-1',
        {
          identity: {
            name: 'Button',
            filePath: '/src/Button.tsx',
            exportName: 'Button',
            hash: 'hash-1',
          },
          allVariants: {
            size: {
              prop: 'size',
              values: new Set(['small', 'medium', 'large']),
              defaultValue: 'medium',
            },
          },
          allStates: new Set(['hover', 'focus', 'disabled']),
          allProps: {
            p: { property: 'padding', scale: 'space' },
          },
          groups: ['space'],
          extraction: { baseStyles: { padding: '8px' } } as any,
          metadata: { className: 'Button-abc123', hash: 'hash-1' } as any,
        },
      ],
    ]),
    metadata: {
      timestamp: Date.now(),
      projectRoot: '/project',
      totalComponents: 1,
      totalVariants: 1,
      totalStates: 3,
    },
    fileDependencies: new Set(['/src/Button.tsx']),
  });

  describe('Serialization and Deserialization', () => {
    it('should correctly serialize component graph to JSON', () => {
      const cache = new ActualGraphCache('/project');
      const graph = createMockComponentGraph();

      // Setup mocks
      mockFS.existsSync.mockReturnValue(true);

      // Save the graph
      cache.save(graph);

      // Verify the serialization
      expect(mockFS.writeFileSync).toHaveBeenCalledWith(
        '/project/.animus-cache/component-graph.json',
        expect.any(String)
      );

      // Get the serialized content
      const serializedContent = mockFS.writeFileSync.mock.calls[0][1];
      const serialized = JSON.parse(serializedContent);

      // Verify structure is preserved
      expect(serialized.components).toHaveLength(1);
      expect(serialized.components[0][0]).toBe('hash-1');
      expect(serialized.components[0][1].identity.name).toBe('Button');

      // Verify Sets are converted to arrays
      expect(Array.isArray(serialized.components[0][1].allStates)).toBe(true);
      expect(serialized.components[0][1].allStates).toEqual([
        'hover',
        'focus',
        'disabled',
      ]);

      // Verify variant values are arrays
      expect(
        Array.isArray(serialized.components[0][1].allVariants.size.values)
      ).toBe(true);
      expect(serialized.components[0][1].allVariants.size.values).toEqual([
        'small',
        'medium',
        'large',
      ]);
    });

    it('should correctly deserialize JSON back to component graph', () => {
      const cache = new ActualGraphCache('/project');

      // Mock serialized data
      const serializedData = {
        components: [
          [
            'hash-1',
            {
              identity: {
                name: 'Button',
                filePath: '/src/Button.tsx',
                exportName: 'Button',
                hash: 'hash-1',
              },
              allVariants: {
                size: {
                  prop: 'size',
                  values: ['small', 'medium', 'large'], // Array in JSON
                  defaultValue: 'medium',
                },
              },
              allStates: ['hover', 'focus', 'disabled'], // Array in JSON
              allProps: {
                p: { property: 'padding', scale: 'space' },
              },
              groups: ['space'],
              extraction: { baseStyles: { padding: '8px' } },
              metadata: { className: 'Button-abc123', hash: 'hash-1' },
            },
          ],
        ],
        metadata: {
          timestamp: Date.now(),
          projectRoot: '/project',
          totalComponents: 1,
          totalVariants: 1,
          totalStates: 3,
        },
        fileDependencies: ['/src/Button.tsx'],
      };

      mockFS.existsSync.mockReturnValue(true);
      mockFS.readFileSync.mockReturnValue(JSON.stringify(serializedData));

      const loaded = cache.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.components).toBeInstanceOf(Map);
      expect(loaded!.components.size).toBe(1);

      const component = loaded!.components.get('hash-1');
      expect(component).toBeDefined();

      // Verify Sets are reconstructed
      expect(component!.allStates).toBeInstanceOf(Set);
      expect(component!.allStates.size).toBe(3);
      expect(component!.allStates.has('hover')).toBe(true);

      // Verify variant values are Sets
      expect(component!.allVariants.size.values).toBeInstanceOf(Set);
      expect(component!.allVariants.size.values.has('medium')).toBe(true);

      // Verify file dependencies are Set
      expect(loaded!.fileDependencies).toBeInstanceOf(Set);
      expect(loaded!.fileDependencies.has('/src/Button.tsx')).toBe(true);
    });

    it('should handle resolution map serialization', () => {
      const cache = new ActualGraphCache('/project');
      const graph = {
        ...createMockComponentGraph(),
        resolutionMap: {
          '/src/App.tsx': {
            Button: {
              componentHash: 'hash-1',
              originalName: 'Button',
            },
          },
        },
      };

      mockFS.existsSync.mockReturnValue(true);

      cache.save(graph);

      // Verify resolution map is saved separately
      expect(mockFS.writeFileSync).toHaveBeenCalledWith(
        '/project/.animus-cache/resolution-map.json',
        JSON.stringify(graph.resolutionMap, null, 2)
      );
    });
  });

  describe('Cache Validation Logic', () => {
    it('should validate cache based on file timestamps', () => {
      const cache = new ActualGraphCache('/project');
      const graph = createMockComponentGraph();

      // Mock file timestamps
      const cacheTime = Date.now() - 1000; // Cache is 1 second old
      const fileTime = Date.now() - 2000; // File is 2 seconds old (older than cache)

      graph.metadata.timestamp = cacheTime;

      mockFS.statSync.mockReturnValue({
        mtimeMs: fileTime,
      });

      // Cache should be valid (file hasn't changed since cache)
      expect(cache.isValid(graph)).toBe(true);
    });

    it('should invalidate cache when files are newer', () => {
      const cache = new ActualGraphCache('/project');
      const graph = createMockComponentGraph();

      const cacheTime = Date.now() - 2000; // Cache is 2 seconds old
      const fileTime = Date.now() - 1000; // File is 1 second old (newer than cache)

      graph.metadata.timestamp = cacheTime;

      mockFS.statSync.mockReturnValue({
        mtimeMs: fileTime,
      });

      // Cache should be invalid (file changed after cache)
      expect(cache.isValid(graph)).toBe(false);
    });

    it('should invalidate cache when files dont exist', () => {
      const cache = new ActualGraphCache('/project');
      const graph = createMockComponentGraph();

      mockFS.statSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(cache.isValid(graph)).toBe(false);
    });

    it('should handle null graph validation', () => {
      const cache = new ActualGraphCache('/project');
      expect(cache.isValid(null)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted cache files gracefully', () => {
      const cache = new ActualGraphCache('/project');

      mockFS.existsSync.mockReturnValue(true);
      mockFS.readFileSync.mockReturnValue('invalid json {{');

      const loaded = cache.load();
      expect(loaded).toBeNull();
    });

    it('should handle missing cache directory on save', () => {
      const cache = new ActualGraphCache('/project');
      const graph = createMockComponentGraph();

      mockFS.existsSync.mockReturnValue(false);

      cache.save(graph);

      // Should create directory
      expect(mockFS.mkdirSync).toHaveBeenCalledWith('/project/.animus-cache', {
        recursive: true,
      });
    });

    it('should handle corrupted resolution map gracefully', () => {
      const cache = new ActualGraphCache('/project');

      const validGraphData = {
        components: [],
        metadata: {
          timestamp: Date.now(),
          projectRoot: '/project',
          totalComponents: 0,
          totalVariants: 0,
          totalStates: 0,
        },
        fileDependencies: [],
      };

      mockFS.existsSync.mockImplementation(() => true);
      mockFS.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('component-graph.json')) {
          return JSON.stringify(validGraphData);
        }
        if (filePath.includes('resolution-map.json')) {
          return 'invalid json {{';
        }
        return '';
      });

      const loaded = cache.load();

      // Should load graph without resolution map
      expect(loaded).not.toBeNull();
      expect(loaded!.resolutionMap).toBeUndefined();
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear cache files', () => {
      const cache = new ActualGraphCache('/project');

      mockFS.existsSync.mockReturnValue(true);

      cache.clear();

      expect(mockFS.unlinkSync).toHaveBeenCalledWith(
        '/project/.animus-cache/component-graph.json'
      );
      expect(mockFS.unlinkSync).toHaveBeenCalledWith(
        '/project/.animus-cache/resolution-map.json'
      );
    });

    it('should handle missing files during clear', () => {
      const cache = new ActualGraphCache('/project');

      mockFS.existsSync.mockReturnValue(false);

      // Should not throw
      expect(() => cache.clear()).not.toThrow();
      expect(mockFS.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('Complex Data Structures', () => {
    it('should handle deeply nested component data', () => {
      const cache = new ActualGraphCache('/project');
      const complexGraph: ComponentGraph = {
        components: new Map([
          [
            'hash-complex',
            {
              identity: {
                name: 'ComplexComponent',
                filePath: '/src/Complex.tsx',
                exportName: 'default',
                hash: 'hash-complex',
              },
              allVariants: {
                size: {
                  prop: 'size',
                  values: new Set(['xs', 'sm', 'md', 'lg', 'xl']),
                  defaultValue: 'md',
                },
                variant: {
                  prop: 'variant',
                  values: new Set(['primary', 'secondary', 'danger']),
                  defaultValue: 'primary',
                },
              },
              allStates: new Set([
                'hover',
                'focus',
                'active',
                'disabled',
                'loading',
              ]),
              allProps: {
                p: { property: 'padding', scale: 'space' },
                m: { property: 'margin', scale: 'space' },
                bg: { property: 'backgroundColor', scale: 'colors' },
              },
              groups: ['space', 'color', 'typography'],
              extraction: {
                baseStyles: {
                  padding: '16px',
                  margin: { _: '0', sm: '8px', lg: '16px' },
                  '&:hover': {
                    transform: 'translateY(-2px)',
                  },
                },
                variants: [
                  {
                    prop: 'size',
                    variants: {
                      xs: { padding: '4px' },
                      sm: { padding: '8px' },
                    },
                  },
                ],
                states: {
                  disabled: { opacity: 0.5 },
                },
              } as any,
              metadata: {
                className: 'ComplexComponent-xyz789',
                hash: 'hash-complex',
                hasResponsiveStyles: true,
              } as any,
            },
          ],
        ]),
        metadata: {
          timestamp: Date.now(),
          projectRoot: '/project',
          totalComponents: 1,
          totalVariants: 2,
          totalStates: 5,
        },
        fileDependencies: new Set(['/src/Complex.tsx', '/src/theme.ts']),
      };

      mockFS.existsSync.mockReturnValue(true);

      // Save and load
      cache.save(complexGraph);

      const serialized = JSON.parse(mockFS.writeFileSync.mock.calls[0][1]);
      mockFS.readFileSync.mockReturnValue(JSON.stringify(serialized));

      const loaded = cache.load();

      // Verify complex structures are preserved
      expect(loaded).not.toBeNull();
      const component = loaded!.components.get('hash-complex');
      expect(component).toBeDefined();

      // Check nested responsive values
      expect(component?.extraction?.baseStyles?.margin).toEqual({
        _: '0',
        sm: '8px',
        lg: '16px',
      });

      // Check all Sets are reconstructed
      expect(component!.allVariants.size.values.size).toBe(5);
      expect(component!.allVariants.variant.values.size).toBe(3);
      expect(component!.allStates.size).toBe(5);
    });
  });
});
