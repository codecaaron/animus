import {
  buildKitDescriptor,
  KIT_DESCRIPTOR_FILE,
  kitDescriptorDiagnostics,
  readKitDescriptor,
} from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

import { config } from '../fixtures/setup';
import { analyzeProject } from './run-pipeline';

import type {
  KitDescriptor,
  KitDescriptorRecord,
  ProjectManifest,
} from '@animus-ui/extract/pipeline';

/**
 * A kit build describes the kit: format 1, its system's fingerprint, and per
 * component its definition fingerprint and the props that accept runtime
 * values. An application reading a kit rejects a format it cannot read, and
 * warns when the shipped source no longer declares a described definition,
 * judging each described component by its own analysed file.
 */
const button = (
  radius: string
) => `import { ds } from '../../../fixtures/setup';
export const Button = ds
  .styles({ cursor: 'pointer', borderRadius: '${radius}' })
  .variant({ prop: 'size', variants: { sm: { cursor: 'help' } } })
  .states({ busy: { cursor: 'wait' } })
  .system({ space: true })
  .props({ lift: { property: 'boxShadow' } })
  .asElement('button');
export const Use = () => <Button size="sm" />;`;

const analyze = (path: string, source: string): ProjectManifest =>
  JSON.parse(
    analyzeProject(JSON.stringify([{ path, source }]), {
      selectorAliasesJson: config.selectorAliases,
    })
  );

const appRoot = mkdtempSync(join(tmpdir(), 'animus-kit-descriptor-'));
const kitRoot = join(appRoot, 'node_modules', 'kit');
mkdirSync(kitRoot, { recursive: true });
afterAll(() => rmSync(appRoot, { recursive: true, force: true }));

const descriptor = buildKitDescriptor(analyze('src/Button.tsx', button('4px')));
const publish = (
  contents: Omit<KitDescriptor, 'format'> & { format: number }
) =>
  writeFileSync(join(kitRoot, KIT_DESCRIPTOR_FILE), JSON.stringify(contents));
const appDiagnostics = (radius: string) => {
  const record = readKitDescriptor(kitRoot, appRoot);
  const records: KitDescriptorRecord[] = record ? [record] : [];
  return kitDescriptorDiagnostics(
    records,
    analyze('node_modules/kit/src/Button.tsx', button(radius))
  );
};

test('a kit build describes each component and the props that accept runtime values', () => {
  expect(descriptor.format).toBe(1);
  expect(descriptor.system).toMatch(/^[0-9a-f]{16}$/);
  const described = descriptor.components['src/Button.tsx::Button'];
  expect(described.definition).toMatch(/^[0-9a-f]{16}$/);
  expect(described.runtimeProps).toEqual(
    expect.arrayContaining(['lift', 'p', 'm'])
  );
  expect(described.runtimeProps).not.toContain('size');
  expect(described.runtimeProps).not.toContain('busy');
});

test('an application reads a current descriptor without a diagnostic', () => {
  publish(descriptor);
  expect(appDiagnostics('4px')).toEqual([]);
});

test('a descriptor whose definitions the shipped source no longer declares is stale', () => {
  publish(descriptor);
  expect(appDiagnostics('8px')).toEqual([
    expect.objectContaining({
      code: 'animus.kit.stale-descriptor',
      kind: 'warn',
      component: 'Button',
      file: `node_modules/kit/${KIT_DESCRIPTOR_FILE}`,
    }),
  ]);
});

test('a described component is judged only when its own file was analysed', () => {
  const unjudged = { definition: '0'.repeat(16), runtimeProps: [] };
  publish({
    ...descriptor,
    components: {
      ...descriptor.components,
      'src/cards/Card.tsx::Card': unjudged,
      'src/Button.tsx::Badge': unjudged,
    },
  });
  expect(appDiagnostics('4px')).toEqual([
    expect.objectContaining({
      code: 'animus.kit.stale-descriptor',
      component: 'Badge',
      message: expect.stringContaining('no longer declares'),
    }),
  ]);
});

test('an unknown descriptor format is an error', () => {
  publish({ ...descriptor, format: 2 });
  expect(appDiagnostics('4px')).toEqual([
    expect.objectContaining({
      code: 'animus.kit.unsupported-format',
      kind: 'error',
      severity: 'error',
      message: expect.stringContaining('format 2'),
    }),
  ]);
});
