#!/usr/bin/env bun

// measure:type-budget — what the style-object types cost the checker.
// A measurement, not a gate: it fails only when a fixture does not compile.
//
// Every fixture compiles through packages/system/__tests__/tsconfig.test-d.json
// with its include narrowed to the system source and that one fixture, since
// each fixture declares its own theme. Generated fixtures vary one dimension
// at a time: declared contextual variables, style positions (one style object
// passed to .styles(), a variant option or a state) and nested selector
// depth. The floor fixture declares a system and writes no style object, so
// a fixture's own cost is its delta over the floor.
//
// Usage:
//   bun scripts/type-budget/measure.ts [--runs <n>] [--write]
// Prints each fixture's instantiations, types and median check time, with
// deltas against scripts/type-budget/baseline.json. --write re-records it.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

interface FixtureLoad {
  vars: number;
  positions: number;
  depth: number;
}

interface Fixture {
  name: string;
  /** Absent for a committed fixture, which is measured as written. */
  load?: FixtureLoad;
  source: string;
}

interface Measurement {
  load?: FixtureLoad;
  instantiations: number;
  types: number;
  checkMs: number;
}

interface Machine {
  platform: string;
  cpu: string;
  cores: number;
  memoryGb: number;
  node: string;
}

interface RunOptions {
  runs: number;
  write: boolean;
}

interface BudgetRecord {
  typescript: string;
  machine: Machine;
  recordedOn: string;
  runs: number;
  fixtures: Record<string, Measurement>;
}

const ROOT = resolve(import.meta.dirname, '../..');
const TSC = join(ROOT, 'node_modules/.bin/tsc');
const TYPE_TEST_CONFIG = join(
  ROOT,
  'packages/system/__tests__/tsconfig.test-d.json'
);
const SYSTEM_SRC = join(ROOT, 'packages/system/src');
const OPEN_SIGNATURE_FIXTURE = join(
  ROOT,
  'packages/system/__tests__/open-custom-property.test-d.ts'
);
const RECORD_PATH = join(import.meta.dirname, 'baseline.json');
const WORK_DIR = join(ROOT, 'node_modules/.cache/animus-type-budget');

const SERIES = {
  vars: [0, 8, 32, 128],
  positions: [1, 8, 32, 128],
  depth: [0, 1, 2, 4, 8],
} as const satisfies Record<keyof FixtureLoad, readonly number[]>;
const BASE_LOAD: FixtureLoad = { vars: 8, positions: 8, depth: 1 };
const SELECTORS = ['_hover', '&:focus-visible', '_focus', '&::after'];

function parseArgs(argv: readonly string[]): RunOptions {
  const runsAt = argv.indexOf('--runs');
  const runs = runsAt === -1 ? 5 : Number(argv[runsAt + 1]);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('--runs takes a positive integer');
  }
  return { runs, write: argv.includes('--write') };
}

function importPath(fromDir: string, target: string): string {
  const path = relative(fromDir, target).split('\\').join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

function styleObject(load: FixtureLoad, position: number): string {
  const value = load.vars === 0 ? `'red'` : `'ctx-${position % load.vars}'`;
  const leaf = `p: 4, bg: ${value}, '--slot-${position}': 'blue'`;
  let object = `{ ${leaf} }`;
  for (let level = load.depth; level > 0; level -= 1) {
    const selector = SELECTORS[(level - 1) % SELECTORS.length];
    object = `{ ${leaf}, '${selector}': ${object} }`;
  }
  return object;
}

/** Up to four positions per component: styles, two variant options, a state. */
function component(load: FixtureLoad, index: number, count: number): string {
  const at = (offset: number): string => styleObject(load, index * 4 + offset);
  let chain = `ds.styles(${at(0)})`;
  if (count >= 2) {
    const options = count >= 3 ? `a: ${at(1)}, b: ${at(2)}` : `a: ${at(1)}`;
    chain += `.variant({ prop: 'tone', variants: { ${options} } })`;
  }
  if (count >= 4) chain += `.states({ busy: ${at(3)} })`;
  return `export const C${index} = ${chain}.asElement('div');`;
}

function generatedSource(load: FixtureLoad, fixtureDir: string): string {
  const system = importPath(fixtureDir, SYSTEM_SRC);
  const varNames = Array.from({ length: load.vars }, (_, i) => `'ctx-${i}'`);
  const declared =
    load.vars === 0
      ? ''
      : `\n  .declareContextualVars({ colors: [${varNames.join(', ')}] })`;
  const components: string[] = [];
  for (let start = 0; start < load.positions; start += 4) {
    components.push(
      component(load, start / 4, Math.min(4, load.positions - start))
    );
  }
  return `import { createSystem, createTheme } from '${system}';
import { color, space } from '${system}/groups';

const theme = createTheme()
  .addScale({ name: 'space', values: { 0: '0', 4: '0.25rem', 8: '0.5rem' } })
  .addColors({ red: '#f00', blue: '#00f' })${declared}
  .build();

type FixtureTheme = typeof theme;

declare module '${system}' {
  interface Theme extends FixtureTheme {}
}

export const ds = createSystem()
  .addGroup('space', space)
  .addGroup('surface', color)
  .build()
  .seal();

${components.join('\n')}
`;
}

function loadName(load: FixtureLoad): string {
  return `vars-${load.vars}_positions-${load.positions}_depth-${load.depth}`;
}

function fixtures(): Fixture[] {
  const loads = new Map<string, FixtureLoad>();
  const floor: FixtureLoad = { vars: 0, positions: 0, depth: 0 };
  loads.set(loadName(floor), floor);
  for (const key of ['vars', 'positions', 'depth'] as const) {
    for (const size of SERIES[key]) {
      const load = { ...BASE_LOAD, [key]: size };
      loads.set(loadName(load), load);
    }
  }
  const generated = [...loads].map(([name, load]) => ({
    name,
    load,
    source: generatedSource(load, join(WORK_DIR, name)),
  }));
  return [
    ...generated,
    {
      name: 'open-custom-property',
      source: readFileSync(OPEN_SIGNATURE_FIXTURE, 'utf8'),
    },
  ];
}

/** Writes the fixture's tsconfig, and its source when generated. */
function prepare(fixture: Fixture): string {
  const dir = join(WORK_DIR, fixture.name);
  mkdirSync(dir, { recursive: true });
  const entry =
    fixture.load === undefined
      ? OPEN_SIGNATURE_FIXTURE
      : join(dir, 'fixture.ts');
  if (fixture.load !== undefined) writeFileSync(entry, fixture.source);
  const config = join(dir, 'tsconfig.json');
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        extends: importPath(dir, TYPE_TEST_CONFIG),
        compilerOptions: { rootDir: importPath(dir, ROOT) },
        include: [
          `${importPath(dir, SYSTEM_SRC)}/**/*.ts`,
          `${importPath(dir, SYSTEM_SRC)}/**/*.tsx`,
          importPath(dir, entry),
        ],
        exclude: [`${importPath(dir, SYSTEM_SRC)}/**/*.test.ts`],
      },
      null,
      2
    )}\n`
  );
  return config;
}

function diagnostic(output: string, label: string): number {
  const match = new RegExp(`^${label}:\\s+([\\d.]+)(s?)$`, 'm').exec(output);
  if (match === null) throw new Error(`tsc printed no "${label}" line`);
  return match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(fixture: Fixture, runs: number): Measurement {
  const config = prepare(fixture);
  const checkTimes: number[] = [];
  let instantiations = 0;
  let types = 0;
  for (let run = 0; run < runs; run += 1) {
    const result = spawnSync(
      TSC,
      ['-p', config, '--noEmit', '--extendedDiagnostics'],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      throw new Error(
        `fixture ${fixture.name} does not compile:\n${result.stdout}${result.stderr}`
      );
    }
    instantiations = diagnostic(result.stdout, 'Instantiations');
    types = diagnostic(result.stdout, 'Types');
    checkTimes.push(diagnostic(result.stdout, 'Check time'));
  }
  return {
    load: fixture.load,
    instantiations,
    types,
    checkMs: Math.round(median(checkTimes)),
  };
}

function typescriptVersion(): string {
  const result = spawnSync(TSC, ['--version'], { encoding: 'utf8' });
  return result.stdout.trim().replace(/^Version\s+/, '');
}

function machine(): Machine {
  return {
    platform: process.platform,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.versions.node,
  };
}

function readRecord(): BudgetRecord | null {
  if (!existsSync(RECORD_PATH)) return null;
  const record: BudgetRecord = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  return record;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function report(current: BudgetRecord, recorded: BudgetRecord | null): void {
  const floor = current.fixtures[loadName({ vars: 0, positions: 0, depth: 0 })];
  console.log(
    `TypeScript ${current.typescript} · ${current.machine.cpu} · ` +
      `${current.machine.cores} cores · node ${current.machine.node} · ` +
      `median of ${current.runs} runs`
  );
  const sameChecker = recorded?.typescript === current.typescript;
  const sameMachine =
    sameChecker &&
    JSON.stringify(recorded?.machine) === JSON.stringify(current.machine);
  if (recorded === null) {
    console.log('No recorded baseline; rerun with --write to record one.');
  } else if (!sameChecker) {
    console.log(
      `Recorded with TypeScript ${recorded.typescript}: no column compares.`
    );
  } else if (!sameMachine) {
    console.log(
      'Recorded on another machine: instantiations compare, check times do not.'
    );
  }
  console.log(
    [
      'fixture'.padEnd(36),
      'instantiations'.padStart(15),
      'over floor'.padStart(11),
      'types'.padStart(9),
      'check ms'.padStart(9),
      'vs record'.padStart(22),
    ].join(' ')
  );
  for (const [name, row] of Object.entries(current.fixtures)) {
    const before = sameChecker ? recorded.fixtures[name] : undefined;
    const versus =
      before === undefined
        ? ''
        : `${signed(row.instantiations - before.instantiations)} inst` +
          (sameMachine ? ` ${signed(row.checkMs - before.checkMs)} ms` : '');
    console.log(
      [
        name.padEnd(36),
        String(row.instantiations).padStart(15),
        signed(row.instantiations - floor.instantiations).padStart(11),
        String(row.types).padStart(9),
        String(row.checkMs).padStart(9),
        versus.padStart(22),
      ].join(' ')
    );
  }
}

function main(): void {
  const { runs, write } = parseArgs(process.argv.slice(2));
  rmSync(WORK_DIR, { recursive: true, force: true });
  const measured: Record<string, Measurement> = {};
  for (const fixture of fixtures()) {
    measured[fixture.name] = measure(fixture, runs);
  }
  const current: BudgetRecord = {
    typescript: typescriptVersion(),
    machine: machine(),
    recordedOn: new Date().toISOString().slice(0, 10),
    runs,
    fixtures: measured,
  };
  report(current, readRecord());
  if (write) {
    mkdirSync(dirname(RECORD_PATH), { recursive: true });
    writeFileSync(RECORD_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Recorded ${relative(ROOT, RECORD_PATH)}.`);
  }
}

main();
