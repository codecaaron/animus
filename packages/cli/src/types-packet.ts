/** `animus types alias`: ordinary compiler declaration output in, a
 *  validated packet with shared registry aliases out.
 *
 *  One run owns `--out` from start to commit through a lock beside it. The
 *  packet is written to a staging directory, checked, and renamed into
 *  place only when every check passes and the declaration input is still
 *  the one it was built from; any failure leaves the previous packet
 *  exactly as it was. Checks:
 *
 *  1. Every packet file, with declaration checking on (skipLibCheck: false),
 *     plus identity assertions: each alias and a literal it replaced are the
 *     same type, once per directory and module flavor.
 *  2. The probe set, once against the ordinary declarations and once against
 *     the packet, each reached the way a consumer reaches it: by package
 *     name through the package's own `exports`. Both must report the same
 *     diagnostics at the same sites, and neither may load package files
 *     outside its route. */

import {
  contentHash,
  findPackageRoot,
  isPathWithinRoot,
} from '@animus-ui/extract/pipeline';
import { isLockHolderAlive } from '@animus-ui/extract/session';
import { spawn } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

import { EnvironmentFailure, UsageFailure } from './build';
import {
  ALIAS_HELPER_FILE,
  collectAnchors,
  helperModule,
  helperReference,
  mayDeclareSystem,
  parseDeclaration,
  rewriteDeclaration,
  scanDeclaration,
} from './types-alias';
import { relocateDeclarationMap } from './types-map';
import {
  DECLARATION_FILE,
  ModuleIdentities,
  packageRoutes,
  toPosix,
} from './types-resolve';

import type {
  AnchorRefusal,
  AnchorSet,
  DeclarationScan,
  ParsedDeclaration,
  RegistryAlias,
} from './types-alias';
import type { ModuleMode } from './types-resolve';

export const PACKET_MANIFEST_FILE = '__animus_packet__.json';
const PACKET_SCHEMA = 1;
const PROBE_FILE = /\.(m|c)?tsx?$/;

export interface TypesAliasOptions {
  /** Compiler declaration output (tsc --declaration / emitDeclarationOnly). */
  declDir: string;
  /** Where the validated packet is promoted. */
  outDir: string;
  /** The producer's tsconfig: the checks inherit its compiler options. */
  project: string;
  /** Consumer probes, checked against both routes. */
  probesDir: string;
  /** Systems declared outside the packet, each `<package specifier>#<export>`. */
  anchors: readonly string[];
  /** The tsc entry to run; defaults to the project's `typescript`. */
  tsc?: string;
}

export interface AliasCount {
  name: string;
  anchor: string;
  replacements: number;
}

export interface TypesAliasReport {
  files: number;
  inputBytes: number;
  outputBytes: number;
  aliases: AliasCount[];
  refusals: AnchorRefusal[];
  probes: { files: number; diagnostics: number };
  /** Files left as emitted, augmentation gaps, and a cleanup failure after
   *  the packet was promoted. */
  warnings: string[];
  timings: {
    alias: number;
    check: number;
    promote: number;
    total: number;
  };
}

interface PacketManifest {
  schema: number;
  input: string;
  aliases: AliasCount[];
  files: Record<string, string>;
}

/** The swap into `--out` stopped half way: neither generation is in place. */
export class PromotionIncompleteError extends Error {
  constructor(outDir: string, cause: Error) {
    super(
      `${outDir} could not be restored after a failed promotion; rerun the build. Cause: ${cause.message}`
    );
    this.name = 'PromotionIncompleteError';
  }
}

// ---------------------------------------------------------------------------
// Inputs, ownership and side directories

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(toPosix(relative(root, path)));
    }
  };
  walk(root);
  return files.sort();
}

/** The compiler output a packet is built from, without build state. */
function inputFiles(declDir: string): string[] {
  return listFiles(declDir).filter((rel) => !rel.endsWith('.tsbuildinfo'));
}

function digestLine(rel: string, bytes: Buffer): string {
  return `${rel}\0${contentHash(bytes)}`;
}

/** One fingerprint of the whole input: rechecked at commit, so output
 *  replaced during a run is never promoted under the old packet's name. */
function inputDigest(lines: readonly string[]): string {
  return contentHash([...lines].sort().join('\n'));
}

function requireDirectory(path: string, role: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new UsageFailure(`${role} ${path} is not a directory`);
  }
}

const SIDE_KINDS = ['staging', 'check', 'retired'] as const;

/** `.<out>.<kind>-<pid>`, beside `--out` so renames stay on one volume. */
function sideDirectory(
  outDir: string,
  kind: (typeof SIDE_KINDS)[number]
): string {
  return join(dirname(outDir), `.${basename(outDir)}.${kind}-${process.pid}`);
}

function isSideEntry(outDir: string, entry: string): boolean {
  return entry.startsWith(`.${basename(outDir)}.`);
}

/** Side directories left by a dead process are debris, removed where the
 *  filesystem allows. Run under the lock. */
function reapAbandoned(outDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dirname(outDir));
  } catch {
    return;
  }
  for (const kind of SIDE_KINDS) {
    const prefix = `.${basename(outDir)}.${kind}-`;
    for (const entry of entries) {
      const pid = Number(entry.slice(prefix.length));
      if (
        !entry.startsWith(prefix) ||
        !Number.isInteger(pid) ||
        isLockHolderAlive(pid)
      ) {
        continue;
      }
      try {
        rmSync(join(dirname(outDir), entry), { recursive: true, force: true });
      } catch {
        // Debris this run cannot remove is no reason to fail it.
      }
    }
  }
}

interface FileExistsError {
  code: 'EEXIST';
}

function isFileExistsError<Value>(
  error: Value
): error is Value & FileExistsError {
  return error instanceof Object && 'code' in error && error.code === 'EEXIST';
}

/** The run's exclusive claim on `--out`, from staging through commit. A
 *  lock whose holder is dead is taken over. */
function acquireLock(outDir: string): () => void {
  const path = join(dirname(outDir), `.${basename(outDir)}.lock`);
  mkdirSync(dirname(outDir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${process.pid}\n`, { flag: 'wx' });
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(path, 'utf8').trim());
    } catch {
      // Removed by its holder between the two calls: retry.
    }
    if (Number.isInteger(holder) && holder > 0 && isLockHolderAlive(holder)) {
      throw new UsageFailure(
        `another \`animus types alias\` (pid ${holder}) owns ${outDir}; wait for it to finish`
      );
    }
    rmSync(path, { force: true });
  }
  throw new UsageFailure(`another \`animus types alias\` took ${outDir} first`);
}

/** Only a directory this command promoted may be replaced. */
function assertReplaceable(outDir: string): void {
  if (!existsSync(outDir)) return;
  let schema: number | undefined;
  try {
    // SAFETY: only `schema` is read, compared against a number below.
    schema = (
      JSON.parse(
        readFileSync(join(outDir, PACKET_MANIFEST_FILE), 'utf8')
      ) as PacketManifest
    ).schema;
  } catch {
    // Reported below.
  }
  if (schema !== PACKET_SCHEMA) {
    throw new UsageFailure(
      `${outDir} exists and is not a packet \`animus types alias\` wrote ` +
        `(no ${PACKET_MANIFEST_FILE}); refusing to replace it. Remove it or ` +
        `choose another --out.`
    );
  }
}

// ---------------------------------------------------------------------------
// Package routing

/** A public entry that selects a packet file. */
interface PacketEntry {
  /** The specifier a consumer writes, `*` for a pattern. */
  specifier: string;
  mode: ModuleMode;
  /** Packet-relative target, `*` for a pattern. */
  target: string;
}

interface PacketRoutes {
  name: string;
  /** The package's `type`, which the probe view keeps. */
  type: string | null;
  entries: PacketEntry[];
  /** Whether consumers reach package files only through `entries`. */
  gated: boolean;
}

/** What each public subpath selects for each module mode, as tsc reads
 *  `exports`. Refuses a route whose `types` condition aims at the packet but
 *  which selects another file first, and a subpath whose import and require
 *  routes select different packet files: the probes check one route. */
function packetRoutes(
  identities: ModuleIdentities,
  packageDir: string,
  outDir: string
): PacketRoutes {
  const manifest = identities.manifest(packageDir);
  const name = manifest?.name;
  if (manifest === null || name === undefined) {
    throw new UsageFailure(`${join(packageDir, 'package.json')} has no name`);
  }
  const { routes, gated } = packageRoutes(manifest);
  const entries: PacketEntry[] = [];
  for (const route of routes) {
    const specifier =
      route.subpath === '.' ? name : `${name}/${route.subpath.slice(2)}`;
    const aimsAtPacket = route.typesTargets.some((target) =>
      isPathWithinRoot(outDir, resolve(packageDir, target))
    );
    const selected = new Map<ModuleMode, string>();
    for (const mode of ['import', 'require'] as const) {
      const target = route.targets[mode];
      if (target === null) continue;
      const absolute = resolve(packageDir, target);
      if (target.includes('*')) {
        if (isPathWithinRoot(outDir, absolute)) {
          selected.set(mode, toPosix(relative(outDir, absolute)));
        }
        continue;
      }
      const file = identities.resolveFile(absolute);
      if (file !== null && isPathWithinRoot(outDir, file)) {
        selected.set(mode, toPosix(relative(outDir, file)));
      } else if (isPathWithinRoot(outDir, absolute)) {
        throw new Error(
          `exports routes ${specifier} (${mode}) to ${target}, which the packet does not contain`
        );
      } else if (aimsAtPacket) {
        throw new UsageFailure(
          `exports ${route.subpath} (${mode}) selects ${target} before its ` +
            `\`types\` condition reaches the packet: put \`types\` first`
        );
      }
    }
    const targets = new Set(selected.values());
    if (targets.size > 1) {
      throw new UsageFailure(
        `exports ${route.subpath} selects ${[...targets].join(' for import and ')} ` +
          `for require; the probe check covers one declaration per subpath`
      );
    }
    for (const [mode, target] of selected) {
      entries.push({ specifier, mode, target });
    }
  }
  if (entries.length === 0) {
    throw new UsageFailure(
      `${join(packageDir, 'package.json')} routes no types into ${outDir}: ` +
        `point an exports \`types\` condition (or \`types\`) at the packet.`
    );
  }
  return { name, type: manifest.type ?? null, entries, gated };
}

function entryMatches(entry: PacketEntry, rel: string): boolean {
  if (!entry.target.includes('*')) return entry.target === rel;
  const [head, tail] = entry.target.split('*');
  return (
    rel.startsWith(head) &&
    rel.endsWith(tail) &&
    rel.length >= head.length + tail.length
  );
}

// ---------------------------------------------------------------------------
// The compiler

interface CompilerDiagnostic {
  file: string | null;
  line: number;
  column: number;
  code: string;
  message: string;
}

interface CompilerRun {
  diagnostics: CompilerDiagnostic[];
  files: string[];
}

function resolveTsc(project: string, explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (!existsSync(explicit)) {
      throw new EnvironmentFailure(`--tsc ${explicit} does not exist`);
    }
    return explicit;
  }
  try {
    const manifest = createRequire(project).resolve('typescript/package.json');
    const tsc = join(dirname(manifest), 'bin', 'tsc');
    if (existsSync(tsc)) return tsc;
  } catch {
    // Reported below.
  }
  throw new EnvironmentFailure(
    `No typescript package resolves from ${dirname(project)}; install it or pass --tsc.`
  );
}

const DIAGNOSTIC_LINE = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_DIAGNOSTIC_LINE = /^error (TS\d+): (.*)$/;

/** Runs tsc on `tsconfig`. Output goes to a file, so the run proceeds while
 *  this process is busy staging the packet. */
function runCompiler(
  tsc: string,
  tsconfig: string,
  extra: readonly string[]
): Promise<CompilerRun> {
  const cwd = dirname(tsconfig);
  const log = `${tsconfig}.log`;
  const args = [tsc, '-p', tsconfig, '--pretty', 'false', ...extra];
  const fd = openSync(log, 'w');
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const output = readFileSync(log, 'utf8');
      const diagnostics: CompilerDiagnostic[] = [];
      const files: string[] = [];
      for (const line of output.split(/\r?\n/)) {
        const located = DIAGNOSTIC_LINE.exec(line);
        const global = GLOBAL_DIAGNOSTIC_LINE.exec(line);
        if (located !== null) {
          diagnostics.push({
            file: resolve(cwd, located[1]),
            line: Number(located[2]),
            column: Number(located[3]),
            code: located[4],
            message: located[5],
          });
        } else if (global !== null) {
          diagnostics.push({
            file: null,
            line: 0,
            column: 0,
            code: global[1],
            message: global[2],
          });
        } else if (isAbsolute(line)) {
          files.push(line);
        }
      }
      // tsc exits non-zero for diagnostics; anything else is a crash.
      if (signal !== null || (code !== 0 && diagnostics.length === 0)) {
        reject(
          new Error(
            `tsc -p ${tsconfig} failed (${signal ?? `exit ${code}`}) without diagnostics:\n${output.slice(0, 4000)}`
          )
        );
        return;
      }
      resolveRun({ diagnostics, files });
    });
  });
}

function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
  const where =
    diagnostic.file === null
      ? ''
      : `${diagnostic.file}(${diagnostic.line},${diagnostic.column}): `;
  return `${where}${diagnostic.code}: ${diagnostic.message}`;
}

/** The overrides that make a producer's options a declaration check. */
interface CheckCompilerOptions {
  noEmit: true;
  skipLibCheck: false;
  incremental: false;
  composite: false;
  declaration: false;
  declarationMap: false;
  emitDeclarationOnly: false;
  noEmitOnError: false;
  rootDir: string;
}

/** A tsconfig inheriting the producer's compiler options, for a check that
 *  emits nothing and checks declaration files. */
function writeCheckProject(
  path: string,
  project: string,
  files: readonly string[]
): void {
  const compilerOptions: CheckCompilerOptions = {
    noEmit: true,
    skipLibCheck: false,
    incremental: false,
    composite: false,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    noEmitOnError: false,
    // Every checked file sits outside the producer's rootDir.
    rootDir: parse(path).root,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ extends: project, compilerOptions, files, include: [] }, null, 2)}\n`
  );
}

// ---------------------------------------------------------------------------
// Staging

interface Witness {
  alias: RegistryAlias;
  rel: string;
  text: string;
  /** The occurrence file's import statements, when the literal names one of
   *  their bindings. */
  imports: string;
}

interface StagedPacket {
  /** Packet-relative path → content hash, of every staged file. */
  files: Map<string, string>;
  inputBytes: number;
  outputBytes: number;
  inputDigest: string;
  aliases: AliasCount[];
  refusals: AnchorRefusal[];
  witnesses: Witness[];
  warnings: string[];
}

/** The emitted import graph, packet and dependencies alike. */
class ImportGraph {
  #external = new Map<string, DeclarationScan>();

  constructor(
    readonly identities: ModuleIdentities,
    /** Absolute packet path → its scan. */
    readonly packet: ReadonlyMap<string, DeclarationScan>
  ) {}

  scanOf(file: string): DeclarationScan {
    const inPacket = this.packet.get(file);
    if (inPacket !== undefined) return inPacket;
    let scan = this.#external.get(file);
    if (scan === undefined) {
      scan = scanDeclaration(
        parseDeclaration(
          file,
          readFileSync(file, 'utf8'),
          this.identities,
          file
        ),
        []
      );
      this.#external.set(file, scan);
    }
    return scan;
  }

  closure(roots: Iterable<string>): Set<string> {
    const reached = new Set<string>();
    const queue = [...roots];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(...this.scanOf(next).imports);
    }
    return reached;
  }
}

/** The augmentations the helper module would add to a file's program: every
 *  module or global augmentation the anchors' declarations reach. */
function anchorAugmentations(
  graph: ImportGraph,
  anchors: AnchorSet
): Set<string> {
  const augmenting = new Set<string>();
  for (const file of graph.closure(anchors.anchorFiles.values())) {
    if (graph.scanOf(file).augments) augmenting.add(file);
  }
  return augmenting;
}

/** tsc keeps no import for a module whose declarations an entry's inferred
 *  types inline, so an augmentation can fall out of an entry's program.
 *  Reported against the emitted imports. */
function augmentationGaps(
  graph: ImportGraph,
  entryRoots: readonly string[],
  outDir: string
): string[] {
  const augmenting = [...graph.packet.entries()]
    .filter(([, scan]) => scan.augments)
    .map(([file]) => file);
  const gaps: string[] = [];
  for (const rel of entryRoots) {
    const reached = graph.closure([join(outDir, rel)]);
    for (const file of augmenting) {
      if (!reached.has(file)) {
        gaps.push(
          `${rel} does not reach the augmentation in ${toPosix(relative(outDir, file))}: ` +
            `add \`export type {} from '<its source module>'\` to the entry's source`
        );
      }
    }
  }
  return gaps;
}

function stagePacket(
  options: TypesAliasOptions,
  identities: ModuleIdentities,
  all: readonly string[],
  routes: PacketRoutes,
  staging: string
): StagedPacket {
  const declarations = all.filter((rel) => DECLARATION_FILE.test(rel));
  const files = new Map<string, string>();
  const inputLines: string[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const readInput = (rel: string): Buffer => {
    const bytes = readFileSync(join(options.declDir, rel));
    inputBytes += bytes.length;
    inputLines.push(digestLine(rel, bytes));
    return bytes;
  };
  const write = (rel: string, bytes: string | Buffer): void => {
    const target = join(staging, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    outputBytes += Buffer.byteLength(bytes);
    files.set(rel, contentHash(bytes));
  };

  // Pass 1: parse and scan every declaration.
  const texts = new Map(
    declarations.map((rel) => [rel, readInput(rel).toString('utf8')])
  );
  const parsed = new Map<string, ParsedDeclaration>();
  for (const [rel, text] of texts) {
    if (mayDeclareSystem(text)) {
      parsed.set(rel, parseDeclaration(rel, text, identities));
    }
  }
  const anchors = collectAnchors(parsed.values(), options.anchors, identities);
  const scans = new Map<string, DeclarationScan>();
  for (const [rel, text] of texts) {
    const declaration =
      parsed.get(rel) ?? parseDeclaration(rel, text, identities);
    parsed.delete(rel);
    scans.set(
      join(options.outDir, rel),
      scanDeclaration(
        declaration,
        anchors.aliases,
        anchors.anchorSpans.get(rel)
      )
    );
  }

  // A file is aliased only when every public entry that reaches it already
  // loads every augmentation the helper module's anchors bring: otherwise
  // the alias would change what that entry's consumers see. Without an
  // `exports` map every file is a public entry.
  const graph = new ImportGraph(identities, scans);
  const required = anchorAugmentations(graph, anchors);
  const entryRoots = routes.gated
    ? declarations.filter((rel) =>
        routes.entries.some((entry) => entryMatches(entry, rel))
      )
    : declarations;
  const entryClosures = entryRoots.map((rel) =>
    graph.closure([join(options.outDir, rel)])
  );
  const warnings: string[] = [];

  // Pass 2: rewrite what may be rewritten, and write the packet.
  const counts = new Map<RegistryAlias, number>(
    anchors.aliases.map((alias) => [alias, 0])
  );
  const witnesses = new Map<string, Witness>();
  const maps = new Set(
    declarations.map((rel) => `${rel}.map`).filter((map) => all.includes(map))
  );
  for (const [rel, text] of texts) {
    const file = join(options.outDir, rel);
    const scan = scans.get(file);
    if (scan === undefined) continue;
    let replacements = scan.replacements;
    if (replacements.length > 0) {
      const missing = [...required].find((augmentation) =>
        entryClosures.some(
          (closure) => closure.has(file) && !closure.has(augmentation)
        )
      );
      if (missing !== undefined) {
        warnings.push(
          `${rel} left as emitted: an entry that reaches it does not load ` +
            `${isPathWithinRoot(options.outDir, missing) ? toPosix(relative(options.outDir, missing)) : missing}, which its aliases would bring in`
        );
        replacements = [];
      }
    }
    for (const replacement of replacements) {
      counts.set(replacement.alias, (counts.get(replacement.alias) ?? 0) + 1);
      const flavor = /\.d\.(m|c)ts$/.exec(rel)?.[1] ?? '';
      const key = [
        replacement.alias.name,
        dirname(rel),
        flavor,
        replacement.usesFileBindings ? rel : '',
      ].join('\0');
      if (!witnesses.has(key)) {
        witnesses.set(key, {
          alias: replacement.alias,
          rel,
          text: text.slice(replacement.start, replacement.end),
          imports: replacement.usesFileBindings ? scan.importStatements : '',
        });
      }
    }
    const rewritten = rewriteDeclaration(rel, text, replacements);
    write(rel, rewritten.text);
    const map = `${rel}.map`;
    if (maps.has(map)) {
      write(
        map,
        relocateDeclarationMap(
          readInput(map).toString('utf8'),
          text,
          rewritten.text,
          rewritten.edits,
          join(options.declDir, map),
          join(options.outDir, map)
        )
      );
    }
  }
  for (const rel of all) {
    if (!DECLARATION_FILE.test(rel) && !maps.has(rel)) {
      write(rel, readInput(rel));
    }
  }

  const used = anchors.aliases.filter((alias) => (counts.get(alias) ?? 0) > 0);
  if (used.length > 0) write(ALIAS_HELPER_FILE, helperModule(used));
  return {
    files,
    inputBytes,
    outputBytes,
    inputDigest: inputDigest(inputLines),
    aliases: used.map((alias) => ({
      name: alias.name,
      anchor: `${alias.anchorSpecifier}#${alias.anchorExport}.${alias.member}`,
      replacements: counts.get(alias) ?? 0,
    })),
    refusals: anchors.refusals,
    witnesses: [...witnesses.values()],
    warnings: routes.gated
      ? [...warnings, ...augmentationGaps(graph, entryRoots, options.outDir)]
      : warnings,
  };
}

// ---------------------------------------------------------------------------
// Checks

const IDENTITY_CHECK_PREFIX = '__animus_identity_check_';

/** One file per witness, beside its occurrence and in its module flavor, so
 *  the literal resolves as it did there. */
function writeIdentityChecks(staging: string, packet: StagedPacket): string[] {
  return packet.witnesses.map(({ alias, rel, text, imports }, index) => {
    const flavor = /\.d\.(m|c)ts$/.exec(rel)?.[1] ?? '';
    const path = join(
      staging,
      dirname(rel),
      `${IDENTITY_CHECK_PREFIX}${index}__.${flavor}ts`
    );
    writeFileSync(
      path,
      [
        imports,
        `type Literal = ${text};`,
        `type Alias = ${helperReference(rel, alias)};`,
        'type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
        `export const ${alias.name}_identical: Identical<Literal, Alias> = true;`,
        '',
      ].join('\n')
    );
    return path;
  });
}

function probeFiles(probesDir: string): string[] {
  const files = listFiles(probesDir).filter((rel) => PROBE_FILE.test(rel));
  if (files.length === 0) {
    throw new UsageFailure(`--probes ${probesDir} holds no .ts or .tsx files`);
  }
  return files;
}

/** A consumer's view of the package, with `--out` replaced by one route's
 *  declarations: probes copied into it import the package by name, and tsc
 *  resolves that through the package's real `exports`. The view has its own
 *  package.json, so the probes sit outside the package's own scope. */
interface ProbeView {
  label: 'ordinary' | 'aliased';
  /** Real path of the declarations this route serves as `--out`. */
  root: string;
  /** The other route's root, which this route must never load. */
  other: string;
  dir: string;
  project: string;
}

interface ProbeViewContext {
  options: TypesAliasOptions;
  packageDir: string;
  routes: PacketRoutes;
  probes: readonly string[];
  checkDir: string;
}

/** Links every entry of `source` into `target`, except the path to `--out`,
 *  which leads to `routeRoot` instead. */
function mirrorPackage(
  source: string,
  target: string,
  outParts: readonly string[],
  routeRoot: string,
  skip: (entry: string) => boolean
): void {
  mkdirSync(target, { recursive: true });
  for (const entry of existsSync(source) ? readdirSync(source) : []) {
    if (entry === 'package.json' || entry === outParts[0] || skip(entry)) {
      continue;
    }
    symlinkSync(join(source, entry), join(target, entry));
  }
  const [next, ...rest] = outParts;
  if (rest.length === 0) {
    symlinkSync(routeRoot, join(target, next));
  } else {
    mirrorPackage(
      join(source, next),
      join(target, next),
      rest,
      routeRoot,
      () => false
    );
  }
}

interface ProbeScope {
  name: string;
  private: true;
  type?: string;
}

function writeProbeView(
  label: ProbeView['label'],
  root: string,
  other: string,
  context: ProbeViewContext
): ProbeView {
  const { options, packageDir, routes, probes, checkDir } = context;
  const dir = join(checkDir, label);
  const view = join(dir, 'node_modules', ...routes.name.split('/'));
  mirrorPackage(
    packageDir,
    view,
    relative(packageDir, options.outDir).split(sep),
    root,
    (entry) => entry === 'node_modules' || isSideEntry(options.outDir, entry)
  );
  copyFileSync(join(packageDir, 'package.json'), join(view, 'package.json'));
  const scope: ProbeScope = {
    name: 'animus-types-alias-probes',
    private: true,
  };
  if (routes.type !== null) scope.type = routes.type;
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(scope)}\n`);
  for (const rel of probes) {
    mkdirSync(dirname(join(dir, 'probes', rel)), { recursive: true });
    copyFileSync(join(options.probesDir, rel), join(dir, 'probes', rel));
  }
  const project = join(dir, 'tsconfig.json');
  writeCheckProject(
    project,
    options.project,
    probes.map((rel) => join(dir, 'probes', rel))
  );
  return {
    label,
    root: realpathSync(root),
    other: realpathSync(other),
    dir: realpathSync(dir),
    project,
  };
}

function auditLoaded(
  view: ProbeView,
  run: CompilerRun,
  ambient: ReadonlySet<string>,
  packageDir: string,
  outDir: string
): string[] {
  const problems: string[] = [];
  if (!run.files.some((file) => isPathWithinRoot(view.root, file))) {
    problems.push(`${view.label} probes loaded nothing from ${view.root}`);
  }
  for (const file of run.files) {
    if (
      isPathWithinRoot(view.root, file) ||
      isPathWithinRoot(view.dir, file) ||
      ambient.has(file)
    ) {
      continue;
    }
    if (isPathWithinRoot(view.other, file) || isPathWithinRoot(outDir, file)) {
      problems.push(`${view.label} probes loaded ${file} from another route`);
    } else if (
      isPathWithinRoot(packageDir, file) &&
      !file.split(sep).includes('node_modules')
    ) {
      problems.push(
        `${view.label} probes loaded ${file}, a package file outside the packet`
      );
    }
  }
  return problems;
}

interface Validation {
  tsc: string;
  routes: PacketRoutes;
  probes: string[];
  packageDir: string;
  context: ProbeViewContext;
  ordinary: ProbeView;
  ordinaryRun: Promise<CompilerRun>;
  /** Files the project loads with no probe at all: its ambient types. */
  ambientRun: Promise<CompilerRun>;
}

/** Everything the checks need that does not depend on the packet, and the
 *  runs that proceed while the packet is staged. */
function startValidation(
  options: TypesAliasOptions,
  identities: ModuleIdentities,
  staging: string,
  checkDir: string
): Validation {
  const tsc = resolveTsc(options.project, options.tsc);
  const packageDir = realpathSync(
    findPackageRoot(join(options.outDir, 'package.json'))
  );
  if (!existsSync(join(packageDir, 'package.json'))) {
    throw new UsageFailure(`no package.json above ${options.outDir}`);
  }
  const routes = packetRoutes(identities, packageDir, options.outDir);
  const probes = probeFiles(options.probesDir);
  mkdirSync(checkDir, { recursive: true });
  const context: ProbeViewContext = {
    options,
    packageDir,
    routes,
    probes,
    checkDir,
  };
  const ordinary = writeProbeView(
    'ordinary',
    options.declDir,
    staging,
    context
  );
  const ambientDir = join(checkDir, 'ambient');
  writeCheckProject(join(ambientDir, 'tsconfig.json'), options.project, [
    join(ambientDir, 'empty.ts'),
  ]);
  writeFileSync(join(ambientDir, 'empty.ts'), 'export {};\n');
  const ordinaryRun = runCompiler(tsc, ordinary.project, ['--listFiles']);
  const ambientRun = runCompiler(tsc, join(ambientDir, 'tsconfig.json'), [
    '--listFilesOnly',
  ]);
  // Awaited by validate or by the cleanup; never an unhandled rejection.
  ordinaryRun.catch(() => undefined);
  ambientRun.catch(() => undefined);
  return {
    tsc,
    routes,
    probes,
    packageDir,
    context,
    ordinary,
    ordinaryRun,
    ambientRun,
  };
}

async function validate(
  options: TypesAliasOptions,
  staging: string,
  checkDir: string,
  packet: StagedPacket,
  validation: Validation
): Promise<{ files: number; diagnostics: number }> {
  const { tsc, probes, packageDir, ordinary } = validation;
  const identityChecks = writeIdentityChecks(staging, packet);
  const packetProject = join(checkDir, 'packet', 'tsconfig.json');
  writeCheckProject(packetProject, options.project, [
    ...[...packet.files.keys()]
      .filter((rel) => DECLARATION_FILE.test(rel))
      .map((rel) => join(staging, rel)),
    ...identityChecks,
  ]);
  const aliased = writeProbeView(
    'aliased',
    staging,
    options.declDir,
    validation.context
  );
  const [packetRun, ordinaryRun, aliasedRun, ambientRun] = await Promise.all([
    runCompiler(tsc, packetProject, []),
    validation.ordinaryRun,
    runCompiler(tsc, aliased.project, ['--listFiles']),
    validation.ambientRun,
  ]);
  for (const path of identityChecks) rmSync(path);

  if (packetRun.diagnostics.length > 0) {
    throw new Error(
      `the packet fails declaration checking (skipLibCheck: false):\n  ${packetRun.diagnostics
        .slice(0, 20)
        .map(formatDiagnostic)
        .join('\n  ')}`
    );
  }
  const ambient = new Set(ambientRun.files);
  const problems: string[] = [];
  const probeSites = (view: ProbeView, run: CompilerRun): Set<string> => {
    problems.push(
      ...auditLoaded(view, run, ambient, packageDir, options.outDir)
    );
    const probeRoot = join(view.dir, 'probes');
    const sites = new Set<string>();
    for (const diagnostic of run.diagnostics) {
      if (
        diagnostic.file !== null &&
        isPathWithinRoot(probeRoot, realpathSync(diagnostic.file))
      ) {
        sites.add(
          `${toPosix(relative(probeRoot, realpathSync(diagnostic.file)))}(${diagnostic.line},${diagnostic.column}) ${diagnostic.code}`
        );
      } else {
        problems.push(`${view.label} route: ${formatDiagnostic(diagnostic)}`);
      }
    }
    return sites;
  };
  const ordinarySites = probeSites(ordinary, ordinaryRun);
  const aliasedSites = probeSites(aliased, aliasedRun);
  for (const site of ordinarySites) {
    if (!aliasedSites.has(site)) {
      problems.push(`only the ordinary declarations report ${site}`);
    }
  }
  for (const site of aliasedSites) {
    if (!ordinarySites.has(site)) {
      problems.push(`only the packet reports ${site}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the packet does not check as the ordinary declarations do:\n  ${problems.slice(0, 20).join('\n  ')}`
    );
  }
  return { files: probes.length, diagnostics: aliasedSites.size };
}

// ---------------------------------------------------------------------------
// Promotion

/** Rename the staged packet into place. Between the two renames `--out` is
 *  absent, which fails a consumer loudly rather than serving a mix. Once the
 *  new packet is in place the run has succeeded; removing the old one is
 *  cleanup, and its failure is a warning. */
function promote(staging: string, outDir: string): string | null {
  const retired = sideDirectory(outDir, 'retired');
  const replacing = existsSync(outDir);
  if (replacing) renameSync(outDir, retired);
  try {
    renameSync(staging, outDir);
  } catch (error) {
    if (!replacing) throw error;
    try {
      renameSync(retired, outDir);
    } catch (restore) {
      throw new PromotionIncompleteError(
        outDir,
        restore instanceof Error ? restore : new Error(String(restore))
      );
    }
    throw error;
  }
  if (!replacing) return null;
  try {
    rmSync(retired, { recursive: true, force: true });
    return null;
  } catch (error) {
    return `the previous packet could not be removed from ${retired} (${String(error)}); the next run removes it once it is writable`;
  }
}

/** Every path as the compiler reports it: real, so `/tmp` and
 *  `/private/tmp` never compare unequal. */
function canonicalOptions(options: TypesAliasOptions): TypesAliasOptions {
  const real = (path: string): string =>
    existsSync(path) ? realpathSync(path) : path;
  mkdirSync(dirname(options.outDir), { recursive: true });
  return {
    ...options,
    declDir: real(options.declDir),
    outDir: join(
      realpathSync(dirname(options.outDir)),
      basename(options.outDir)
    ),
    project: real(options.project),
    probesDir: real(options.probesDir),
  };
}

export async function runTypesAlias(
  given: TypesAliasOptions
): Promise<TypesAliasReport> {
  const started = performance.now();
  const options = canonicalOptions(given);
  requireDirectory(options.declDir, 'declaration directory');
  requireDirectory(options.probesDir, '--probes');
  if (!existsSync(options.project)) {
    throw new UsageFailure(`--project ${options.project} does not exist`);
  }
  if (
    isPathWithinRoot(options.declDir, options.outDir) ||
    isPathWithinRoot(options.outDir, options.declDir)
  ) {
    throw new UsageFailure(
      '--out and the declaration directory must not contain each other'
    );
  }
  const release = acquireLock(options.outDir);
  const staging = sideDirectory(options.outDir, 'staging');
  const checkDir = sideDirectory(options.outDir, 'check');
  let validation: Validation | null = null;
  try {
    reapAbandoned(options.outDir);
    assertReplaceable(options.outDir);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    const all = inputFiles(options.declDir);
    const declarations = all.filter((rel) => DECLARATION_FILE.test(rel));
    if (declarations.length === 0) {
      throw new UsageFailure(`${options.declDir} holds no declaration files`);
    }
    for (const reserved of [ALIAS_HELPER_FILE, PACKET_MANIFEST_FILE]) {
      if (all.includes(reserved)) {
        throw new UsageFailure(
          `${options.declDir} already holds ${reserved}: pass the compiler's declaration output, not a packet`
        );
      }
    }
    const identities = new ModuleIdentities(
      options.outDir,
      new Set(declarations)
    );
    validation = startValidation(options, identities, staging, checkDir);
    const packet = stagePacket(
      options,
      identities,
      all,
      validation.routes,
      staging
    );
    const aliased = performance.now();
    const probes = await validate(
      options,
      staging,
      checkDir,
      packet,
      validation
    );
    const checked = performance.now();

    const current = inputDigest(
      inputFiles(options.declDir).map((rel) =>
        digestLine(rel, readFileSync(join(options.declDir, rel)))
      )
    );
    if (current !== packet.inputDigest) {
      throw new Error(
        `${options.declDir} changed during the run; the packet built from the old output was not promoted`
      );
    }
    const manifest: PacketManifest = {
      schema: PACKET_SCHEMA,
      input: packet.inputDigest,
      aliases: packet.aliases,
      files: Object.fromEntries(
        [...packet.files].sort(([a], [b]) => (a < b ? -1 : 1))
      ),
    };
    // The manifest lands last in the staged tree: a packet without one was
    // never complete.
    writeFileSync(
      join(staging, PACKET_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    assertReplaceable(options.outDir);
    const cleanup = promote(staging, options.outDir);
    const promoted = performance.now();
    return {
      files: packet.files.size,
      inputBytes: packet.inputBytes,
      outputBytes: packet.outputBytes,
      aliases: packet.aliases,
      refusals: packet.refusals,
      probes,
      warnings:
        cleanup === null ? packet.warnings : [...packet.warnings, cleanup],
      timings: {
        alias: aliased - started,
        check: checked - aliased,
        promote: promoted - checked,
        total: promoted - started,
      },
    };
  } finally {
    // A failure before the checks finish leaves runs going; they write into
    // the check directory removed below.
    await validation?.ordinaryRun.catch(() => undefined);
    await validation?.ambientRun.catch(() => undefined);
    rmSync(staging, { recursive: true, force: true });
    rmSync(checkDir, { recursive: true, force: true });
    release();
  }
}

export function formatTypesAliasReport(
  report: TypesAliasReport,
  outDir: string
): string {
  const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(2)} MB`;
  const lines = [
    `[animus] types alias: promoted ${outDir} — ${report.files} files, ` +
      `${mb(report.inputBytes)} → ${mb(report.outputBytes)}`,
  ];
  for (const alias of report.aliases) {
    lines.push(
      `[animus]   ${alias.name} (${alias.anchor}): ${alias.replacements} replacements`
    );
  }
  for (const refusal of report.refusals) {
    lines.push(
      `[animus]   not aliased: ${refusal.file}#${refusal.anchorExport}: ${refusal.reason}`
    );
  }
  for (const warning of report.warnings) {
    lines.push(`[animus]   warning: ${warning}`);
  }
  lines.push(
    `[animus]   checks: packet clean with skipLibCheck: false; ${report.probes.files} probe files, ` +
      `${report.probes.diagnostics} diagnostics at the same sites on both routes`
  );
  lines.push(
    `[animus]   ${report.timings.alias.toFixed(0)} ms alias, ${report.timings.check.toFixed(0)} ms checks, ` +
      `${report.timings.promote.toFixed(0)} ms promote`
  );
  return `${lines.join('\n')}\n`;
}
