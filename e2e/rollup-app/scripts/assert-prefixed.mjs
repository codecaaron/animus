import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The prefixed fixture root under `prefixContextualVars`, built by the CLI:
// every contextual variable is emitted under its prefixed name, in the CSS
// and in the runtime config a runtime value reads.
const EXPECTED = [
  '@property --acme-tone{',
  'background-color:var(--acme-tone)',
  '--acme-tone:red',
  '--edge:var(--acme-cap,var(--acme-tone))',
  '--ring:var(--acme-tone)',
  'transition:--acme-tone 1s',
  'style(--acme-tone:red)',
  '--acme-cap:2px',
  '--acme-cap:40rem',
  '--acme-tone:var(--acme-color-ink)',
  '--acme-cap:var(--animus-cap-size)',
  // A condition alias, a runtime keyword on the currentVar prop, and a
  // declaration-scale record value.
  'style(--acme-tone:blue)',
  '--acme-cap:3px',
  '--acme-tone:inherit',
  '-look--color:var(--acme-tone)',
];
/** A declared name the prefix should have renamed. */
const DECLARED = /(?<![\w-])--(?:tone|cap)(?![\w-])/;
const PREFIXED = /--acme-(?:tone|cap)(?![\w-])/g;
/** The runtime config of `capSize`, the prop a runtime value reaches; a
 *  bundler may quote its strings with ", ' or `. */
const RUNTIME_EXPECTED = [
  /property["'`]?:["'`]--acme-cap["'`]/,
  /\bcap["'`]?:["'`]var\(--acme-cap\)["'`]/,
  /currentVar["'`]?:["'`]--acme-tone["'`]/,
  /\bcolor["'`]?:["'`]var\(--acme-tone\)["'`]/,
];
const RUNTIME_DECLARED = /["'`]--(?:tone|cap)["'`]/;

/** Whitespace removed around punctuation, so minified and readable output
 *  compare alike. */
function normalize(text) {
  return text.replace(/\s*([{}:;,()])\s*/g, '$1').replace(/\s+/g, ' ');
}

function assertPrefixed(css, runtime) {
  const text = normalize(css);
  const config = normalize(runtime);
  const prefixed = text.match(PREFIXED) ?? [];
  const failures = [
    ...(prefixed.length === 0
      ? ['no --acme- names at all: the variant built nothing to check']
      : []),
    ...EXPECTED.filter((expected) => !text.includes(expected)).map(
      (expected) => `missing \`${expected}\``
    ),
    ...(DECLARED.test(text)
      ? [
          `a declared name kept its unprefixed form: ${DECLARED.exec(text)?.[0]}`,
        ]
      : []),
    ...(config.includes('--acme-cap')
      ? []
      : ['no runtime config names --acme-cap: nothing to check']),
    ...RUNTIME_EXPECTED.filter((expected) => !expected.test(config)).map(
      (expected) => `runtime config is missing ${expected}`
    ),
    ...(RUNTIME_DECLARED.test(config)
      ? [`runtime config keeps ${RUNTIME_DECLARED.exec(config)?.[0]}`]
      : []),
  ];
  if (failures.length > 0) {
    throw new Error(`prefixed variant:\n  ${failures.join('\n  ')}`);
  }
  console.log(`prefixed variant: ${prefixed.length} final names, all present`);
}

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'animus-rollup-prefixed-'));
try {
  const build = spawnSync(
    join(lane, 'node_modules', '.bin', 'animus'),
    [
      'build',
      '--root',
      'fixtures/prefixed-root',
      '--strict',
      '--out-dir',
      outDir,
    ],
    { cwd: lane, encoding: 'utf-8' }
  );
  if (build.status !== 0) {
    throw new Error(`prefixed build exited ${build.status}:\n${build.stderr}`);
  }
  // The runtime config is the components' replacement code; the rest of
  // the manifest records the authored source.
  const manifest = JSON.parse(
    readFileSync(join(outDir, 'manifest.json'), 'utf8')
  );
  assertPrefixed(
    readFileSync(join(outDir, 'styles.css'), 'utf8'),
    Object.values(manifest.components)
      .map((component) => component.replacement)
      .join('\n')
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
