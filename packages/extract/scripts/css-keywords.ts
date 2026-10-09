/**
 * Derives the CSS keywords a strict scale prop admits beside its tokens from
 * the public type contract (`PropertyValues<{ property }, false>` over the
 * pinned csstype), writes the extractor's `css_keywords.json`, and with
 * `--check` fails when the file differs from a fresh derivation.
 *
 * Usage: node packages/extract/scripts/css-keywords.ts [--write | --check]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');

export const KEYWORD_FILE = join(
  ROOT,
  'packages/extract/crates/extract-v2/src/css_keywords.json'
);

export interface CssKeywords {
  /** The CSS-wide keywords every property admits. */
  globals: string[];
  /** Each property's own keywords, globals excluded; absent when it has none. */
  properties: Record<string, string[]>;
}

/** A probe's expected error: `Symbol()` rejected at the declared name. */
const PROBE_DIAGNOSTIC =
  /probe\.ts\((\d+),14\): error TS2322: Type 'unique symbol' is not assignable to type '(.*)'\.$/;

/** The parts of a finished child process the derivation reads. */
export interface ToolRun {
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string | null;
  stderr: string | null;
}

function checkExit(tool: string, run: ToolRun, expected: number): void {
  if (run.error) {
    throw new Error(
      `css-keywords: ${tool} could not run: ${run.error.message}`
    );
  }
  if (run.status !== expected) {
    const ended =
      run.status === null ? `signal ${run.signal}` : `status ${run.status}`;
    throw new Error(
      `css-keywords: ${tool} ended with ${ended}, expected ${expected}\n` +
        `${run.stdout ?? ''}${run.stderr ?? ''}`
    );
  }
}

/** A key every probe object carries, so an empty union still rejects `Symbol()`. */
const PROBE_KEY = '~probe';

/**
 * The keys of the one object type in a printed probe type. A key prints as
 * its literal, so an alias the compiler chose for the union cannot hide it.
 */
function mappedKeys(printed: string): string[] {
  const body = /\{(.*)\}/.exec(printed)?.[1] ?? '';
  return body
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const key = entry.slice(0, entry.lastIndexOf(':')).trim();
      return key.startsWith('"') ? String(JSON.parse(key)) : key;
    })
    .filter((key) => key !== PROBE_KEY);
}

/**
 * Each probe's string-literal members, from exactly one assignability error
 * at its declaration; a valid error may list none. Probes are declared from
 * `firstLine` on, so tsc must exit 1; any other output fails the derivation.
 */
export function probeLiterals(
  run: ToolRun,
  firstLine: number,
  declarations: string[]
): string[][] {
  checkExit('tsc', run, 1);
  if (run.stderr?.trim()) {
    throw new Error(`css-keywords: tsc wrote to stderr: ${run.stderr}`);
  }
  const unions: (string[] | undefined)[] = declarations.map(() => undefined);
  for (const line of (run.stdout ?? '').split('\n')) {
    if (line.trim() === '') continue;
    const match = PROBE_DIAGNOSTIC.exec(line);
    const index = match ? Number(match[1]) - firstLine : -1;
    if (!match || index < 0 || index >= declarations.length) {
      throw new Error(`css-keywords: unexpected compiler output: ${line}`);
    }
    if (unions[index]) {
      throw new Error(
        `css-keywords: two diagnostics for probe ${index} (${declarations[index]}): ${line}`
      );
    }
    unions[index] = mappedKeys(match[2]);
  }
  return unions.map((union, index) => {
    if (union === undefined) {
      throw new Error(
        `css-keywords: no diagnostic for probe ${index} (${declarations[index]}); ` +
          'its type admits Symbol(), for example because it became any'
      );
    }
    return union;
  });
}

/** `--write` reports success only after the formatter has laid out the file. */
export function checkFormatterRun(run: ToolRun): void {
  checkExit('vp fmt', run, 0);
}

/** The string-literal members of each probed type, read from the compiler's
 *  untruncated assignability errors: the type checker is the authority. Each
 *  union is probed as the keys of a mapped type, because the compiler prints
 *  a union through whatever alias it was first built with, while it prints
 *  every key of an object type as its literal. */
function literalUnions(header: string[], declarations: string[]): string[][] {
  const dir = mkdtempSync(join(tmpdir(), 'css-keywords-'));
  try {
    writeFileSync(
      join(dir, 'probe.ts'),
      [
        ...header,
        ...declarations.map(
          (type, i) =>
            `export const k${i}: { [K in ${type} | '${PROBE_KEY}']: 0 } | 0n = Symbol();`
        ),
      ].join('\n') + '\n'
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        extends: join(ROOT, 'tsconfig.json'),
        compilerOptions: { noEmit: true, noErrorTruncation: true, types: [] },
        files: [join(dir, 'probe.ts')],
      })
    );
    const run = spawnSync(
      join(ROOT, 'node_modules/.bin/tsc'),
      ['-p', join(dir, 'tsconfig.json')],
      { cwd: dir, encoding: 'utf8' }
    );
    // Diagnostic lines are one-based and follow the header.
    return probeLiterals(run, header.length + 1, declarations);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SYSTEM = join(ROOT, 'packages/system/src');

export function deriveCssKeywords(): CssKeywords {
  const [names] = literalUnions(
    [`import type { PropertyTypes } from '${SYSTEM}/types/properties';`],
    ['Exclude<keyof PropertyTypes, `--${string}`>']
  );
  if (names.length === 0) {
    throw new Error('css-keywords: the property list could not be derived');
  }
  const unions = literalUnions(
    [
      `import type { PropertyValues } from '${SYSTEM}/types/config';`,
      'type Literal<T> = T extends string ? ({} extends Record<T, 1> ? never : T) : never;',
    ],
    names.map(
      (name) => `Literal<PropertyValues<{ property: '${name}' }, false>>`
    )
  );
  const admitting = unions.filter((union) => union.length > 0);
  const globals = admitting[0].filter((keyword) =>
    admitting.every((union) => union.includes(keyword))
  );
  const properties: Record<string, string[]> = {};
  names.forEach((name, i) => {
    const own = unions[i].filter((keyword) => !globals.includes(keyword));
    if (own.length > 0) properties[name] = own;
  });
  return {
    globals,
    properties: Object.fromEntries(
      Object.entries(properties).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
  };
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const derived = deriveCssKeywords();
  if (process.argv.includes('--check')) {
    const current: unknown = JSON.parse(readFileSync(KEYWORD_FILE, 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(derived)) {
      // oxlint-disable-next-line no-console -- the check's failure report
      console.error(`css-keywords: stale ${KEYWORD_FILE}; run --write`);
      process.exit(1);
    }
  } else {
    writeFileSync(KEYWORD_FILE, `${JSON.stringify(derived, null, 2)}\n`);
    // The committed bytes are the repository formatter's layout.
    checkFormatterRun(
      spawnSync(join(ROOT, 'node_modules/.bin/vp'), ['fmt', KEYWORD_FILE], {
        cwd: ROOT,
        encoding: 'utf8',
      })
    );
  }
}
