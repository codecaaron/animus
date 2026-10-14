import { surfaceManifestDiagnostics } from '@animus-ui/extract/pipeline';
import { beforeAll, describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline, transformFile } from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

// Inline rather than under fixtures/components, which is also the parity corpus.
const SYSTEM = {
  path: 'fixtures/member-system.ts',
  source: `import { createSystem } from '@animus-ui/system';
const bundle = createSystem().build();
export const ds = bundle.seal();
`,
};

const KIT = {
  path: 'fixtures/member-kit.tsx',
  source: `import { ds } from './member-system';
export const SelectContent = ds.styles({ display: 'flex' }).asElement('div');
export const Select = { Content: SelectContent };
`,
};

const CHILD_DECLARATION = `export const ShortSelectContent = Select.Content.extend().styles({ maxHeight: '240px' }).asElement('div');`;

const CHILD = {
  path: 'fixtures/member-child.tsx',
  source: `import { Select, SelectContent } from './member-kit';
${CHILD_DECLARATION}
export const WideSelectContent = SelectContent.extend().styles({ minWidth: '320px' }).asElement('div');
`,
};

/** Another library's builder with Animus's method names. */
const LOOKALIKE_KIT = {
  path: 'fixtures/lookalike-kit.tsx',
  source: `import { lib } from 'other-lib';
export const Panel = lib.styles({ padding: 4 }).asElement('section');
export const Other = { Panel };
`,
};

const LOOKALIKE_DECLARATION = `export const WidePanel = Other.Panel.extend().styles({ width: '100%' }).asElement('section');`;

const LOOKALIKE_CHILD = {
  path: 'fixtures/lookalike-child.tsx',
  source: `import { Other } from './lookalike-kit';
${LOOKALIKE_DECLARATION}
`,
};

/** Objects whose `Content` a later spread, computed key or write may replace. */
const OVERWRITE_KIT = {
  path: 'fixtures/overwrite-kit.tsx',
  source: `import { foreignParts } from 'other-lib';
import { SelectContent } from './member-kit';
export const Spread = { Content: SelectContent, ...foreignParts };
export const Computed = { Content: SelectContent, ['Content']: foreignParts.Content };
export const Restored = { ...foreignParts, Content: SelectContent };
export const Mutated = { Content: SelectContent };
Mutated.Content = foreignParts.Content;
export const ComputedMutated = { Content: SelectContent };
ComputedMutated[foreignParts.key] = foreignParts.Content;
export const Assigned = { Content: SelectContent };
Object.assign(Assigned, { Content: foreignParts.Content });
export const Untouched = { Content: SelectContent };
Untouched.Other = foreignParts.Content;
`,
};

const OVERWRITE_CHILD = {
  path: 'fixtures/overwrite-child.tsx',
  source: `import {
  Assigned,
  Computed,
  ComputedMutated,
  Mutated,
  Restored,
  Spread,
  Untouched,
} from './overwrite-kit';
export const SpreadContent = Spread.Content.extend().styles({ width: '10px' }).asElement('div');
export const ComputedContent = Computed.Content.extend().styles({ width: '20px' }).asElement('div');
export const RestoredContent = Restored.Content.extend().styles({ width: '30px' }).asElement('div');
export const MutatedContent = Mutated.Content.extend().styles({ width: '40px' }).asElement('div');
export const ComputedMutatedContent = ComputedMutated.Content.extend().styles({ width: '50px' }).asElement('div');
export const AssignedContent = Assigned.Content.extend().styles({ width: '60px' }).asElement('div');
export const UntouchedContent = Untouched.Content.extend().styles({ width: '70px' }).asElement('div');
`,
};

function codesOf(diagnostics: ManifestDiagnostic[], component: string) {
  return diagnostics
    .filter((d) => d.component === component)
    .map((d) => d.code);
}

const MEMBER_PARENT_WARNING =
  '⚠ fixtures/member-child.tsx:2:35: ' +
  "ShortSelectContent not extracted: chain dropped: parent 'Select.Content' " +
  "is a member of exported object 'Select', and member-parent extension is " +
  'not supported; the declaration in fixtures/member-child.tsx is left ' +
  "untransformed — extend 'SelectContent' from fixtures/member-kit.tsx " +
  'directly [animus.extension.unsupported-member-parent]';

describe('extending a member of an exported Animus namespace object', () => {
  let manifest: ReturnType<typeof runPipeline>['manifest'];
  let css: string;
  let diagnostics: ManifestDiagnostic[];
  let childDiagnostics: ManifestDiagnostic[];

  // Transform reads the engine of the latest analysis, so analysis runs here
  // rather than at collection time, where another file's clear can follow it.
  beforeAll(() => {
    clearAnalysisCache();
    ({ manifest, css } = runPipeline(
      [
        SYSTEM,
        KIT,
        CHILD,
        LOOKALIKE_KIT,
        LOOKALIKE_CHILD,
        OVERWRITE_KIT,
        OVERWRITE_CHILD,
      ],
      { devMode: true }
    ));
    assertNoUnresolvedTokens(css);
    diagnostics = manifest.diagnostics ?? [];
    childDiagnostics = diagnostics.filter(
      (d) => d.component === 'ShortSelectContent'
    );
  });

  function delivered(strict: boolean | undefined): string[] {
    const lines: string[] = [];
    surfaceManifestDiagnostics(manifest, (line) => lines.push(line), {
      strict,
    });
    return lines;
  }

  function strictFailure(): string {
    try {
      delivered(true);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('explicit strictness did not fail');
  }

  test('the native analysis reports one classified bail for the child', () => {
    expect(childDiagnostics).toHaveLength(1);
    expect(childDiagnostics[0]).toMatchObject({
      file: 'fixtures/member-child.tsx',
      kind: 'bail',
      code: 'animus.extension.unsupported-member-parent',
      severity: 'error',
    });
  });

  test('the bail is not an unresolved-parent rediscovery request', () => {
    expect(manifest.missing_inputs ?? []).toEqual([]);
    expect(
      diagnostics.filter((d) => d.code === 'animus.extension.unresolved-parent')
    ).toHaveLength(0);
  });

  test('shared delivery warns once with omitted or false build strictness', () => {
    for (const strict of [undefined, false]) {
      const lines = delivered(strict).filter((line) =>
        line.includes('ShortSelectContent')
      );
      expect(lines).toEqual([MEMBER_PARENT_WARNING]);
    }
  });

  test('explicit build strictness fails through the shared policy with the same attribution', () => {
    expect(strictFailure()).toContain(
      'animus.extension.unsupported-member-parent — ' +
        'fixtures/member-child.tsx:2:35: ShortSelectContent: ' +
        "chain dropped: parent 'Select.Content'"
    );
  });

  test('the child declaration is preserved with no fabricated output', () => {
    expect(manifest.components).not.toHaveProperty(
      'fixtures/member-child.tsx::ShortSelectContent'
    );
    expect(css).not.toContain('240px');
    const { code } = transformFile(CHILD.path, CHILD.source);
    expect(code).toContain(CHILD_DECLARATION);
  });

  test('a supported flat extension beside it still extracts', () => {
    const wide =
      manifest.components['fixtures/member-child.tsx::WideSelectContent'];
    expect(wide).toBeDefined();
    expect(css).toContain('min-width: 320px');
    const { code } = transformFile(CHILD.path, CHILD.source);
    expect(code).not.toContain("minWidth: '320px'");
  });

  test('a lookalike builder gets no Animus warning or transformation', () => {
    expect(diagnostics.filter((d) => d.component === 'WidePanel')).toEqual([]);
    expect(
      delivered(false).filter((line) => line.includes('WidePanel'))
    ).toEqual([]);
    expect(strictFailure()).not.toContain('WidePanel');
    expect(manifest.components).not.toHaveProperty(
      'fixtures/lookalike-child.tsx::WidePanel'
    );
    const { code } = transformFile(
      LOOKALIKE_CHILD.path,
      LOOKALIKE_CHILD.source
    );
    expect(code).toContain(LOOKALIKE_DECLARATION);
  });

  test('a member a later spread or computed key may replace proves nothing', () => {
    const codes = (component: string) => codesOf(diagnostics, component);
    expect(codes('SpreadContent')).toEqual([]);
    expect(codes('ComputedContent')).toEqual([]);
    expect(codes('RestoredContent')).toEqual([
      'animus.extension.unsupported-member-parent',
    ]);
  });

  test('a member a later top-level write may replace proves nothing', () => {
    const codes = (component: string) => codesOf(diagnostics, component);
    expect({
      static: codes('MutatedContent'),
      computed: codes('ComputedMutatedContent'),
      objectAssign: codes('AssignedContent'),
      otherKey: codes('UntouchedContent'),
    }).toEqual({
      static: [],
      computed: [],
      objectAssign: [],
      otherKey: ['animus.extension.unsupported-member-parent'],
    });
  });
});

const NAMESPACE_BARREL = {
  path: 'fixtures/namespace-barrel.tsx',
  source: `export * as kit from './member-kit';
`,
};

const NAMESPACE_CHILD = {
  path: 'fixtures/namespace-child.tsx',
  source: `import * as Kit from './member-kit';
import * as Barrel from './namespace-barrel';
import { kit } from './namespace-barrel';
export const TallSelectContent = Kit.SelectContent.extend().styles({ opacity: '0.48' }).asElement('div');
export const DeepSelectContent = Barrel.kit.SelectContent.extend().styles({ opacity: '0.36' }).asElement('div');
export const NamedSelectContent = kit.SelectContent.extend().styles({ opacity: '0.12' }).asElement('div');
export const AbsentSelectContent = Kit.Absent.extend().styles({ opacity: '0.06' }).asElement('div');
`,
};

/** A named import of a namespace whose member is itself an extension of a
 *  namespace member. */
const CHAINED_NAMESPACE = {
  path: 'fixtures/chained-namespace.tsx',
  source: `import { tall } from './chained-barrel';
export const TallerSelectContent = tall.TallSelectContent.extend().styles({ opacity: '0.24' }).asElement('div');
`,
};

const CHAINED_BARREL = {
  path: 'fixtures/chained-barrel.ts',
  source: `export * as tall from './namespace-child';
`,
};

describe('extending a member of a namespace import', () => {
  let manifest: ReturnType<typeof runPipeline>['manifest'];
  let css: string;
  let codes: (component: string) => (string | undefined)[];

  beforeAll(() => {
    clearAnalysisCache();
    ({ manifest, css } = runPipeline(
      [
        SYSTEM,
        KIT,
        NAMESPACE_BARREL,
        NAMESPACE_CHILD,
        CHAINED_BARREL,
        CHAINED_NAMESPACE,
      ],
      { devMode: true }
    ));
    assertNoUnresolvedTokens(css);
    const diagnostics: ManifestDiagnostic[] = manifest.diagnostics ?? [];
    codes = (component) => codesOf(diagnostics, component);
  });

  test('extracts like a named import, through a re-exported namespace too', () => {
    const { code } = transformFile(
      NAMESPACE_CHILD.path,
      NAMESPACE_CHILD.source
    );
    for (const [child, value] of [
      ['TallSelectContent', '0.48'],
      ['DeepSelectContent', '0.36'],
    ]) {
      expect(codes(child)).toEqual([]);
      expect(
        manifest.components[`fixtures/namespace-child.tsx::${child}`]
      ).toMatchObject({
        extends_from: 'fixtures/member-kit.tsx::SelectContent',
      });
      expect(css).toContain(`opacity: ${value}`);
      expect(code).not.toContain(`opacity: '${value}'`);
    }
  });

  test('a named import of a namespace fails strict instead of dropping the child', () => {
    for (const child of ['NamedSelectContent', 'TallerSelectContent']) {
      expect(codes(child)).toEqual([
        'animus.extension.unsupported-member-parent',
      ]);
    }
    expect(css).not.toContain('opacity: 0.12');
  });

  test('a member the namespace lacks is a dropped extension the host refuses to serve', () => {
    expect(codes('AbsentSelectContent')).toEqual([
      'animus.extension.unresolved-parent',
    ]);
    expect(manifest.missing_inputs).toEqual([
      expect.objectContaining({
        component: 'AbsentSelectContent',
        parent: 'Kit.Absent',
        specifier: './member-kit',
      }),
    ]);
  });
});

const CAST_CHILD = {
  path: 'fixtures/cast-child.tsx',
  source: `import * as Kit from './member-kit';
import { SelectContent } from './member-kit';
export const NamedCast = (SelectContent as any).extend().styles({ opacity: '0.71' }).asElement('div');
export const NamespaceCast = (Kit as any).SelectContent.extend().styles({ opacity: '0.72' }).asElement('div');
`,
};

// Contract: a type assertion on an extension's parent is erased, so the
// extension extracts as it does without one.
test('an extension whose parent is written through a type assertion extracts', () => {
  clearAnalysisCache();
  const { manifest, css } = runPipeline([SYSTEM, KIT, CAST_CHILD], {
    devMode: true,
  });
  assertNoUnresolvedTokens(css);
  const { code } = transformFile(CAST_CHILD.path, CAST_CHILD.source);
  for (const [child, value] of [
    ['NamedCast', '0.71'],
    ['NamespaceCast', '0.72'],
  ]) {
    expect(codesOf(manifest.diagnostics ?? [], child)).toEqual([]);
    expect(
      manifest.components[`fixtures/cast-child.tsx::${child}`]
    ).toMatchObject({ extends_from: 'fixtures/member-kit.tsx::SelectContent' });
    expect(css).toContain(`opacity: ${value}`);
    expect(code).not.toContain(`opacity: '${value}'`);
  }
});
