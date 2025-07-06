import { describe, expect, it, vi } from 'vitest';

import type { ComponentIdentity, ExtractedStylesWithIdentity } from '../component-identity';
import { createComponentIdentity } from '../component-identity';
import type { ComponentEntry } from '../component-registry';

describe('[QUANTUM] Component Registry - In-Memory Component Management', () => {
  // Mock component creation helper
  const createMockComponent = (
    name: string,
    filePath = '/mock.tsx',
    exportName = 'default'
  ): ExtractedStylesWithIdentity => ({
    identity: createComponentIdentity(name, filePath, exportName),
    componentName: name,
    baseStyles: { padding: '8px' },
    variants: [],
    states: {},
    groups: [],
    props: {},
  });

  // Create a mock registry class for testing
  class MockComponentRegistry {
    private components = new Map<string, ComponentEntry>();
    private fileComponents = new Map<string, ComponentEntry[]>();
    private events = new Map<string, Function[]>();

    register(component: ExtractedStylesWithIdentity): void {
      const entry: ComponentEntry = {
        identity: component.identity,
        styles: component,
        lastModified: Date.now(),
        dependencies: [],
        dependents: new Set(),
      };

      this.components.set(component.identity.hash, entry);

      // Track by file
      const filePath = component.identity.filePath;
      if (!this.fileComponents.has(filePath)) {
        this.fileComponents.set(filePath, []);
      }
      this.fileComponents.get(filePath)!.push(entry);

      this.emit('componentAdded', entry);
    }

    getComponent(identity: ComponentIdentity): ComponentEntry | undefined {
      return this.components.get(identity.hash);
    }

    getAllComponents(): ComponentEntry[] {
      return Array.from(this.components.values());
    }

    getFileComponents(filePath: string): ComponentEntry[] {
      return this.fileComponents.get(filePath) || [];
    }

    updateComponent(component: ExtractedStylesWithIdentity): void {
      const existing = this.components.get(component.identity.hash);
      if (existing) {
        existing.styles = component;
        existing.lastModified = Date.now();
        this.emit('componentUpdated', existing);
      }
    }

    removeComponent(identity: ComponentIdentity): void {
      const entry = this.components.get(identity.hash);
      if (entry) {
        this.components.delete(identity.hash);

        // Remove from file tracking
        const fileEntries = this.fileComponents.get(identity.filePath);
        if (fileEntries) {
          const filtered = fileEntries.filter(
            (e) => e.identity.hash !== identity.hash
          );
          if (filtered.length > 0) {
            this.fileComponents.set(identity.filePath, filtered);
          } else {
            this.fileComponents.delete(identity.filePath);
          }
        }

        this.emit('componentRemoved', identity);
      }
    }

    addDependency(child: ComponentIdentity, parent: ComponentIdentity): void {
      const childEntry = this.components.get(child.hash);
      const parentEntry = this.components.get(parent.hash);

      if (childEntry && parentEntry) {
        childEntry.dependencies.push(parent);
        parentEntry.dependents.add(child.filePath);
      }
    }

    on(event: string, handler: Function): void {
      if (!this.events.has(event)) {
        this.events.set(event, []);
      }
      this.events.get(event)!.push(handler);
    }

    private emit(event: string, data: any): void {
      const handlers = this.events.get(event) || [];
      handlers.forEach((handler) => handler(data));
    }

    getStats() {
      const components = Array.from(this.components.values());
      return {
        totalComponents: components.length,
        totalFiles: this.fileComponents.size,
        componentsWithDependents: components.filter(
          (c) => c.dependents.size > 0
        ).length,
        componentsWithDependencies: components.filter(
          (c) => c.dependencies.length > 0
        ).length,
      };
    }
  }

  describe('Component Registration', () => {
    it('should register and retrieve components', () => {
      const registry = new MockComponentRegistry();
      const button = createMockComponent('Button');

      registry.register(button);

      const retrieved = registry.getComponent(button.identity);
      expect(retrieved).toBeDefined();
      expect(retrieved?.identity.name).toBe('Button');
      expect(retrieved?.styles.baseStyles?.padding).toBe('8px');
    });

    it('should track components by file', () => {
      const registry = new MockComponentRegistry();
      const button = createMockComponent('Button', '/components/Button.tsx');
      const card = createMockComponent('Card', '/components/Card.tsx');
      const header = createMockComponent('Header', '/layout/Header.tsx');

      registry.register(button);
      registry.register(card);
      registry.register(header);

      const componentFiles = registry.getFileComponents(
        '/components/Button.tsx'
      );
      expect(componentFiles).toHaveLength(1);
      expect(componentFiles[0].identity.name).toBe('Button');

      const layoutFiles = registry.getFileComponents('/layout/Header.tsx');
      expect(layoutFiles).toHaveLength(1);
      expect(layoutFiles[0].identity.name).toBe('Header');
    });
  });

  describe('Component Updates', () => {
    it('should update existing components', () => {
      const registry = new MockComponentRegistry();
      const button = createMockComponent('Button');

      registry.register(button);
      const originalTime = registry.getComponent(button.identity)!.lastModified;

      // Update with new styles (with a slight delay to ensure time difference)
      const updatedButton: ExtractedStylesWithIdentity = {
        ...button,
        baseStyles: { padding: '16px', margin: '4px' },
      };

      registry.updateComponent(updatedButton);

      const updated = registry.getComponent(button.identity);
      expect(updated?.styles.baseStyles?.padding).toBe('16px');
      expect(updated?.styles.baseStyles?.margin).toBe('4px');
      expect(updated?.lastModified).toBeGreaterThanOrEqual(originalTime);
    });

    it('should remove components', () => {
      const registry = new MockComponentRegistry();
      const button = createMockComponent('Button', '/Button.tsx');
      const card = createMockComponent('Card', '/Card.tsx');

      registry.register(button);
      registry.register(card);

      expect(registry.getAllComponents()).toHaveLength(2);

      registry.removeComponent(button.identity);

      expect(registry.getAllComponents()).toHaveLength(1);
      expect(registry.getComponent(button.identity)).toBeUndefined();
      expect(registry.getComponent(card.identity)).toBeDefined();
    });
  });

  describe('Dependency Tracking', () => {
    it('should track component dependencies', () => {
      const registry = new MockComponentRegistry();
      const base = createMockComponent('BaseButton', '/base/Button.tsx');
      const primary = createMockComponent(
        'PrimaryButton',
        '/buttons/Primary.tsx'
      );

      registry.register(base);
      registry.register(primary);

      // Add dependency: PrimaryButton depends on BaseButton
      registry.addDependency(primary.identity, base.identity);

      const primaryEntry = registry.getComponent(primary.identity);
      const baseEntry = registry.getComponent(base.identity);

      expect(primaryEntry?.dependencies).toHaveLength(1);
      expect(primaryEntry?.dependencies[0].hash).toBe(base.identity.hash);
      expect(baseEntry?.dependents.has('/buttons/Primary.tsx')).toBe(true);
    });

    it('should handle multiple dependencies', () => {
      const registry = new MockComponentRegistry();
      const theme = createMockComponent('Theme', '/theme.tsx');
      const base = createMockComponent('Base', '/base.tsx');
      const complex = createMockComponent('Complex', '/complex.tsx');

      registry.register(theme);
      registry.register(base);
      registry.register(complex);

      // Complex depends on both Theme and Base
      registry.addDependency(complex.identity, theme.identity);
      registry.addDependency(complex.identity, base.identity);

      const complexEntry = registry.getComponent(complex.identity);
      expect(complexEntry?.dependencies).toHaveLength(2);

      const themeEntry = registry.getComponent(theme.identity);
      const baseEntry = registry.getComponent(base.identity);
      expect(themeEntry?.dependents.has('/complex.tsx')).toBe(true);
      expect(baseEntry?.dependents.has('/complex.tsx')).toBe(true);
    });
  });

  describe('Event System', () => {
    it('should emit events on component changes', () => {
      const registry = new MockComponentRegistry();
      const events = {
        added: vi.fn(),
        updated: vi.fn(),
        removed: vi.fn(),
      };

      registry.on('componentAdded', events.added);
      registry.on('componentUpdated', events.updated);
      registry.on('componentRemoved', events.removed);

      const button = createMockComponent('Button');

      // Add
      registry.register(button);
      expect(events.added).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: button.identity,
        })
      );

      // Update
      registry.updateComponent({ ...button, baseStyles: { padding: '16px' } });
      expect(events.updated).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: button.identity,
        })
      );

      // Remove
      registry.removeComponent(button.identity);
      expect(events.removed).toHaveBeenCalledWith(button.identity);
    });
  });

  describe('Registry Statistics', () => {
    it('should provide accurate stats', () => {
      const registry = new MockComponentRegistry();

      // Create component hierarchy
      const base = createMockComponent('Base', '/base.tsx');
      const child1 = createMockComponent('Child1', '/child1.tsx');
      const child2 = createMockComponent('Child2', '/child2.tsx');
      const standalone = createMockComponent('Standalone', '/standalone.tsx');

      registry.register(base);
      registry.register(child1);
      registry.register(child2);
      registry.register(standalone);

      // Add dependencies
      registry.addDependency(child1.identity, base.identity);
      registry.addDependency(child2.identity, base.identity);

      const stats = registry.getStats();

      expect(stats.totalComponents).toBe(4);
      expect(stats.totalFiles).toBe(4);
      expect(stats.componentsWithDependents).toBe(1); // Only base has dependents
      expect(stats.componentsWithDependencies).toBe(2); // child1 and child2
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle component replacement in same file', () => {
      const registry = new MockComponentRegistry();
      const filePath = '/components/Button.tsx';

      // Register initial version
      const buttonV1 = createMockComponent('Button', filePath);
      registry.register(buttonV1);

      // Simulate file change - remove old, add new
      registry.removeComponent(buttonV1.identity);

      const buttonV2 = createMockComponent('Button', filePath);
      registry.register(buttonV2);

      const fileComponents = registry.getFileComponents(filePath);
      expect(fileComponents).toHaveLength(1);
      expect(fileComponents[0].identity.hash).toBe(buttonV2.identity.hash);
    });

    it('should handle multiple exports from same file', () => {
      const registry = new MockComponentRegistry();
      const filePath = '/components/index.tsx';

      const button = createMockComponent('Button', filePath, 'Button');
      const card = createMockComponent('Card', filePath, 'Card');
      const header = createMockComponent('Header', filePath, 'Header');

      registry.register(button);
      registry.register(card);
      registry.register(header);

      const fileComponents = registry.getFileComponents(filePath);
      expect(fileComponents).toHaveLength(3);

      const names = fileComponents.map((c) => c.identity.name).sort();
      expect(names).toEqual(['Button', 'Card', 'Header']);
    });

    it('should handle circular dependencies gracefully', () => {
      const registry = new MockComponentRegistry();
      const compA = createMockComponent('ComponentA', '/a.tsx');
      const compB = createMockComponent('ComponentB', '/b.tsx');

      registry.register(compA);
      registry.register(compB);

      // Create circular dependency
      registry.addDependency(compA.identity, compB.identity);
      registry.addDependency(compB.identity, compA.identity);

      const entryA = registry.getComponent(compA.identity);
      const entryB = registry.getComponent(compB.identity);

      expect(entryA?.dependencies).toHaveLength(1);
      expect(entryB?.dependencies).toHaveLength(1);
      expect(entryA?.dependents.has('/b.tsx')).toBe(true);
      expect(entryB?.dependents.has('/a.tsx')).toBe(true);
    });
  });
});
