import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The prefixed variant (prefixed-variant/) under `prefixContextualVars`:
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
  '--acme-cap:var(--animus-cap-size_',
  // A condition alias, a runtime keyword on the currentVar prop, and a
  // declaration-scale record value.
  'style(--acme-tone:blue)',
  '--acme-cap:3px',
  '--acme-tone:inherit',
  '-color_:var(--acme-tone)',
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
function normalize(text: string): string {
  return text.replace(/\s*([{}:;,()])\s*/g, '$1').replace(/\s+/g, ' ');
}

function assertPrefixed(css: string, runtime: string): void {
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

/** The text of every file under `dir` with one of `extensions`. */
function readAll(dir: string, extensions: string[]): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

const dist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../prefixed-variant/dist'
);
assertPrefixed(readAll(dist, ['.css']), readAll(dist, ['.js']));
