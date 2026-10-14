import { beforeAll, describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline, transformFile } from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

const SYSTEM = {
  path: 'forward/system.ts',
  source: `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();
`,
};

const COMPONENTS = {
  path: 'forward/components.tsx',
  source: `import { forwardRef } from 'react';
import { ds } from './system';
const Target = forwardRef((props, ref) => <input ref={ref} {...props} />);
const options = { forward: true };
const base = ds.styles({ display: 'block' }).variant({ prop: 'size', defaultVariant: 'small', variants: { small: { opacity: '0.1' }, large: { opacity: '0.2' } } }).states({ error: { opacity: '0.3' } });
export const Listed = base.asComponent(Target, { forward: ['size', 'error'] });
export const All = base.asComponent(Target, { forward: true });
export const Plain = base.asComponent(Target);
export const Opaque = base.asComponent(Target, options);
export const App = () => <><Listed size="large" error /><All /><Plain /><Opaque /></>;
`,
};

// Contract: an asComponent() terminal's static `forward` reaches its
// extracted runtime config as written, and any other second argument leaves
// the declaration untransformed with a classified error.
describe('asComponent forward extraction', () => {
  let code: string;
  let diagnostics: ManifestDiagnostic[];

  beforeAll(() => {
    clearAnalysisCache();
    const { manifest, css } = runPipeline([SYSTEM, COMPONENTS]);
    assertNoUnresolvedTokens(css);
    diagnostics = manifest.diagnostics ?? [];
    ({ code } = transformFile(COMPONENTS.path, COMPONENTS.source));
  });

  test('writes a listed or `true` forward into the config, and none without one', () => {
    expect(code).toMatch(
      /Listed = createComponent\(Target, '[^']+', \{.*"forward":\["size","error"\]\}\);/
    );
    expect(code).toMatch(
      /All = createComponent\(Target, '[^']+', \{.*"forward":true\}\);/
    );
    expect(code).toMatch(
      /Plain = createComponent\(Target, '[^']+', \{(?!.*"forward").*\}\);/
    );
  });

  test('refuses options it cannot read, at error severity', () => {
    expect(code).toContain('base.asComponent(Target, options)');
    expect(
      diagnostics
        .filter((d) => d.component === 'Opaque')
        .map((d) => [d.code, d.severity])
    ).toEqual([['animus.chain.unsupported-terminal-target', 'error']]);
  });
});
