import { createSystem, createTheme } from '@animus-ui/system';
import { space } from '@animus-ui/system/groups';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import { ExtractionSession } from '../session/extraction-session';
import { getSharedCss, setEngineApiOverride } from '../session/singleton';

import type { V2ExtractEngine } from '../pipeline/engine-adapter';

const NATIVE = join(__dirname, '../index-v2.js');

const theme = createTheme().build();
const ds = createSystem().addGroup('space', space).build().seal();

/** A system prop whose configured transform fails for every value. */
const FAILING = {
  propConfig: { w: { property: 'width', transform: 'boom' } },
  transformSources: { boom: '(v) => ({ bad: v })' },
};

/** The native engine, with the system served in-process: a temp project
 *  cannot resolve `@animus-ui/system` for the engine's own system loader.
 *  `failing` adds the `w` prop, whose transform fails. */
function nativeApiServing(failing = false): () => object {
  let engine: V2ExtractEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  const native = createV2EngineApi({
    label: 'skipped-sources-test',
    isV2: () => true,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadNativeEngine: () => require(NATIVE),
    store: {
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getSentSources: () => sentSources,
      setSentSources: (sources) => {
        sentSources = sources;
      },
      getDriftWarned: () => driftWarned,
      setDriftWarned: (value) => {
        driftWarned = value;
      },
    },
  });
  const config = ds.toConfig();
  const propConfig = failing
    ? JSON.stringify({
        ...JSON.parse(config.propConfig),
        ...FAILING.propConfig,
      })
    : config.propConfig;
  const served = {
    ...theme.serialize(),
    propConfig,
    groupRegistry: config.groupRegistry,
  };
  const system = failing
    ? { ...served, transformSources: JSON.stringify(FAILING.transformSources) }
    : served;
  return () => ({
    ...native(),
    loadSystemModule: () => system,
  });
}

const FILES = {
  'src/ds.ts': 'export const ds = {};\n',
  'src/R.tsx': `import { ds } from './ds';
export const R = ds
  .styles({ display: 'block' })
  .variant({ prop: 'size', variants: { sm: { padding: '1px' }, lg: { padding: '9px' } }, defaultVariant: 'sm' })
  .asElement('div');
`,
  'src/App.tsx': `import { R } from './R';
export const App = () => <R size="sm" />;
`,
};

/** Renders `lg`, but does not compile: the `<R>` is never closed. */
const BROKEN_MDX = `import { R } from './R';\n\n<R size="lg">\n`;

let root: string | null = null;
let session: ExtractionSession | null = null;

afterEach(() => {
  session?.close();
  session = null;
  setEngineApiOverride(null);
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

async function build(extra: Record<string, string>, failing = false) {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-skipped-')));
  for (const [path, source] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  setEngineApiOverride(nativeApiServing(failing));
  session = new ExtractionSession({
    system: './src/ds.ts',
    extensions: ['.ts', '.tsx', '.mdx'],
    mode: 'production',
  });
  session.rootDir = root;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await session.runFullPipeline();
    return {
      css: getSharedCss(),
      warned: warn.mock.calls.map((args) => args.join(' ')).join('\n'),
    };
  } finally {
    warn.mockRestore();
  }
}

describe('a source ingestion skips', () => {
  it('leaves pruning on when nothing is skipped', async () => {
    const { css } = await build({});
    expect(css).toContain('padding:1px');
    expect(css).not.toContain('padding:9px');
  });

  it('keeps every option while a file it cannot see may render them', async () => {
    const { css, warned } = await build({ 'src/Doc.mdx': BROKEN_MDX });
    expect(warned).toContain('SOURCE_MDX_PARSE_ERROR src/Doc.mdx');
    expect(warned).toContain('its renders are not seen, so nothing is pruned');
    expect(css).toContain('padding:1px');
    expect(css).toContain('padding:9px');
  });

  // Only `loud` uses the failing transform, and nothing renders it.
  const LOUD = {
    'src/Tone.tsx': `import { ds } from './ds';
export const Tone = ds
  .styles({ display: 'block' })
  .variant({ prop: 'tone', variants: { quiet: { padding: '1px' }, loud: { w: 2 } }, defaultVariant: 'quiet' })
  .asElement('div');
`,
    'src/App.tsx': `import { R } from './R';
import { Tone } from './Tone';
export const App = () => <><R size="sm" /><Tone tone="quiet" /></>;
`,
  };

  it('warns, without failing, on an error from an option kept only by the skip', async () => {
    const { warned } = await build(
      { ...LOUD, 'src/Doc.mdx': BROKEN_MDX },
      true
    );
    expect(warned).toContain(
      'ships only because pruning is off while src/Doc.mdx is skipped'
    );
  });
});
