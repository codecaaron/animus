import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The prefixed variant (prefixed-variant/) under `prefixContextualVars`:
// every contextual variable is emitted under its prefixed name.
const EXPECTED = [
  '@property --acme-tone{',
  'background-color:var(--acme-tone)',
  '--acme-tone:red',
  '--edge:var(--acme-cap,var(--acme-tone))',
  'transition:--acme-tone 1s',
  '--acme-cap:40rem',
];
/** A declared name the prefix should have renamed. */
const DECLARED = /(?<![\w-])--(?:tone|cap)(?![\w-])/;
const PREFIXED = /--acme-(?:tone|cap)(?![\w-])/g;

/** Whitespace removed around punctuation, so minified and readable CSS
 *  compare alike. */
function normalize(css: string): string {
  return css.replace(/\s*([{}:;,()])\s*/g, '$1').replace(/\s+/g, ' ');
}

function assertPrefixed(css: string): void {
  const text = normalize(css);
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
  ];
  if (failures.length > 0) {
    throw new Error(`prefixed variant:\n  ${failures.join('\n  ')}`);
  }
  console.log(`prefixed variant: ${prefixed.length} final names, all present`);
}

const assets = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../prefixed-variant/dist/assets'
);
assertPrefixed(
  readdirSync(assets)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(assets, name), 'utf8'))
    .join('\n')
);
