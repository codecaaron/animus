/** `animus types alias`: ordinary compiler declaration output in, a
 *  validated packet with shared registry aliases out.
 *
 *  The packet is written to a staging directory beside `--out`, checked,
 *  and renamed into place only when every check passes; any failure leaves
 *  the previous packet exactly as it was. Checks:
 *
 *  1. Every packet file, with declaration checking on (skipLibCheck: false),
 *     plus one identity assertion per alias: the alias and the literal it
 *     replaced are the same type.
 *  2. The probe set, once against the ordinary declarations and once against
 *     the packet, each reached through the package's own `exports` types
 *     routing. Both must report the same diagnostics at the same sites, and
 *     neither may load package source or the other route's files. */

import {
  contentHash,
  findPackageRoot,
  isPathWithinRoot,
} from '@animus-ui/extract/pipeline';
import { isLockHolderAlive } from '@animus-ui/extract/session';
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  ModuleIdentities,
  packageTypesRoutes,
  readPackageManifest,
  toPosix,
} from './types-resolve';

import type {
  AnchorRefusal,
  ParsedDeclaration,
  RegistryAlias,
} from './types-alias';
import type { TextEdit } from './types-map';

export const PACKET_MANIFEST_FILE = '__animus_packet__.json';
const PACKET_SCHEMA = 1;
const DECLARATION_FILE = /\.d\.(m|c)?ts$/;
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
  /** Entries that do not reach a module augmentation in the packet. */
  augmentationGaps: string[];
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

// ---------------------------------------------------------------------------
// Inputs and side directories

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

/** Side directories left by a dead process are debris. */
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
      rmSync(join(dirname(outDir), entry), { recursive: true, force: true });
    }
  }
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

interface PackageRoute {
  /** The specifier a consumer writes, `*` for a pattern. */
  specifier: string;
  /** Packet-relative target, `*` for a pattern. */
  target: string;
}

/** The package's types routes into `outDir`. */
function packetRoutes(packageDir: string, outDir: string): PackageRoute[] {
  const manifest = readPackageManifest(packageDir);
  const name = manifest?.name;
  if (manifest === null || name === undefined) {
    throw new UsageFailure(`${join(packageDir, 'package.json')} has no name`);
  }
  const routes: PackageRoute[] = [];
  for (const { subpath, target } of packageTypesRoutes(manifest)) {
    const absolute = resolve(packageDir, target);
    if (!isPathWithinRoot(outDir, absolute)) continue;
    routes.push({
      specifier: subpath === '.' ? name : `${name}/${subpath.slice(2)}`,
      target: toPosix(relative(outDir, absolute)),
    });
  }
  if (routes.length === 0) {
    throw new UsageFailure(
      `${join(packageDir, 'package.json')} routes no types into ${outDir}: ` +
        `point an exports \`types\` condition (or \`types\`) at the packet.`
    );
  }
  return routes;
}

/** A check project's `paths`: each specifier and the file it resolves to. */
interface CompilerPaths {
  [specifier: string]: string[];
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
  paths?: CompilerPaths;
}

function routePaths(
  routes: readonly PackageRoute[],
  root: string
): CompilerPaths {
  const paths: CompilerPaths = {};
  for (const route of routes)
    paths[route.specifier] = [join(root, route.target)];
  return paths;
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
  listLoaded: boolean
): Promise<CompilerRun> {
  const cwd = dirname(tsconfig);
  const log = `${tsconfig}.log`;
  const args = [tsc, '-p', tsconfig, '--pretty', 'false'];
  if (listLoaded) args.push('--listFiles');
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
        } else if (listLoaded && isAbsolute(line)) {
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

/** A tsconfig inheriting the producer's compiler options, for a check that
 *  emits nothing and checks declaration files. */
function writeCheckProject(
  path: string,
  project: string,
  files: readonly string[],
  paths: CompilerPaths | null
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
  if (paths !== null) compilerOptions.paths = paths;
  writeFileSync(
    path,
    `${JSON.stringify({ extends: project, compilerOptions, files, include: [] }, null, 2)}\n`
  );
}

// ---------------------------------------------------------------------------
// Staging

interface StagedPacket {
  /** Packet-relative path → content hash, of every staged file. */
  files: Map<string, string>;
  inputBytes: number;
  outputBytes: number;
  inputDigest: string;
  aliases: AliasCount[];
  refusals: AnchorRefusal[];
  /** For each alias with replacements, one occurrence to check identity
   *  against: its file and original text. */
  witnesses: Array<{ alias: RegistryAlias; rel: string; text: string }>;
  /** Each declaration's imports of other packet files, as emitted. */
  imports: Map<string, Set<string>>;
  /** Declarations holding a `declare module` or `declare global` block. */
  augmenting: string[];
}

function stagePacket(
  options: TypesAliasOptions,
  staging: string
): StagedPacket {
  const all = listFiles(options.declDir).filter(
    (rel) => !rel.endsWith('.tsbuildinfo')
  );
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

  const files = new Map<string, string>();
  const inputHashes: string[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const readInput = (rel: string): Buffer => {
    const bytes = readFileSync(join(options.declDir, rel));
    inputBytes += bytes.length;
    inputHashes.push(`${rel}\0${contentHash(bytes)}`);
    return bytes;
  };
  const write = (rel: string, bytes: string | Buffer): void => {
    const target = join(staging, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    outputBytes += Buffer.byteLength(bytes);
    files.set(rel, contentHash(bytes));
  };
  const maps = new Set(
    declarations.map((rel) => `${rel}.map`).filter((map) => all.includes(map))
  );
  const writeMap = (
    map: string,
    original: string,
    rewritten: string,
    edits: TextEdit[]
  ): void => {
    write(
      map,
      relocateDeclarationMap(
        readInput(map).toString('utf8'),
        original,
        rewritten,
        edits,
        join(options.declDir, map),
        join(options.outDir, map)
      )
    );
  };

  const texts = new Map(
    declarations.map((rel) => [rel, readInput(rel).toString('utf8')])
  );
  // Files that may declare a system are parsed once here and reused below.
  const parsedCandidates = new Map<string, ParsedDeclaration>();
  for (const [rel, text] of texts) {
    if (mayDeclareSystem(text))
      parsedCandidates.set(rel, parseDeclaration(rel, text, identities));
  }
  const anchors = collectAnchors(
    parsedCandidates.values(),
    options.anchors,
    identities
  );

  const counts = new Map<RegistryAlias, number>(
    anchors.aliases.map((alias) => [alias, 0])
  );
  const witnesses = new Map<RegistryAlias, { rel: string; text: string }>();
  const imports = new Map<string, Set<string>>();
  const augmenting: string[] = [];
  for (const [rel, text] of texts) {
    const parsed =
      parsedCandidates.get(rel) ?? parseDeclaration(rel, text, identities);
    parsedCandidates.delete(rel);
    const scan = scanDeclaration(
      parsed,
      anchors.aliases,
      anchors.anchorSpans.get(rel)
    );
    imports.set(rel, scan.imports);
    if (scan.augments) augmenting.push(rel);
    for (const replacement of scan.replacements) {
      counts.set(replacement.alias, (counts.get(replacement.alias) ?? 0) + 1);
      if (!witnesses.has(replacement.alias) && !replacement.usesFileBindings) {
        witnesses.set(replacement.alias, {
          rel,
          text: text.slice(replacement.start, replacement.end),
        });
      }
    }
    const rewritten = rewriteDeclaration(parsed, scan.replacements);
    write(rel, rewritten.text);
    if (maps.has(`${rel}.map`))
      writeMap(`${rel}.map`, text, rewritten.text, rewritten.edits);
  }
  for (const rel of all) {
    if (!DECLARATION_FILE.test(rel) && !maps.has(rel))
      write(rel, readInput(rel));
  }

  const used = anchors.aliases.filter((alias) => (counts.get(alias) ?? 0) > 0);
  if (used.length > 0) write(ALIAS_HELPER_FILE, helperModule(used));
  return {
    files,
    inputBytes,
    outputBytes,
    inputDigest: contentHash(inputHashes.sort().join('\n')),
    aliases: used.map((alias) => ({
      name: alias.name,
      anchor: `${alias.anchorSpecifier}#${alias.anchorExport}.${alias.member}`,
      replacements: counts.get(alias) ?? 0,
    })),
    refusals: anchors.refusals,
    witnesses: used.flatMap((alias) => {
      const witness = witnesses.get(alias);
      return witness === undefined ? [] : [{ alias, ...witness }];
    }),
    imports,
    augmenting,
  };
}

/** tsc keeps no import for a module whose declarations an entry's inferred
 *  types inline, so an augmentation can fall out of an entry's program.
 *  Reported against the emitted imports, before the helper module adds
 *  edges of its own. */
function augmentationGaps(
  packet: StagedPacket,
  routes: readonly PackageRoute[]
): string[] {
  const gaps: string[] = [];
  for (const route of routes) {
    if (!packet.imports.has(route.target)) continue;
    const reached = new Set([route.target]);
    const queue = [route.target];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const target of packet.imports.get(next) ?? []) {
        if (reached.has(target)) continue;
        reached.add(target);
        queue.push(target);
      }
    }
    for (const rel of packet.augmenting) {
      if (!reached.has(rel)) {
        gaps.push(
          `${route.specifier} (${route.target}) does not reach the augmentation in ${rel}: ` +
            `add \`export type {} from '<its source module>'\` to the entry's source`
        );
      }
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Checks

const IDENTITY_CHECK_PREFIX = '__animus_identity_check_';

/** One file per alias, beside an occurrence so the literal's relative
 *  imports resolve as they did there. */
function writeIdentityChecks(staging: string, packet: StagedPacket): string[] {
  return packet.witnesses.map(({ alias, rel, text }, index) => {
    const path = join(
      staging,
      dirname(rel),
      `${IDENTITY_CHECK_PREFIX}${index}__.ts`
    );
    writeFileSync(
      path,
      [
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
  const files = listFiles(probesDir)
    .filter((rel) => PROBE_FILE.test(rel))
    .map((rel) => join(probesDir, rel));
  if (files.length === 0) {
    throw new UsageFailure(`--probes ${probesDir} holds no .ts or .tsx files`);
  }
  return files;
}

interface ProbeRoute {
  label: 'ordinary' | 'aliased';
  /** Where this route reaches the package's declarations. */
  root: string;
  /** The other route's root, which this route must never load. */
  other: string;
  run: Promise<CompilerRun>;
}

interface Validation {
  tsc: string;
  routes: PackageRoute[];
  probes: string[];
  packageDir: string;
  ordinary: ProbeRoute;
}

/** Everything the checks need that does not depend on the packet, and the
 *  ordinary route's run, which proceeds while the packet is staged. */
function startValidation(
  options: TypesAliasOptions,
  staging: string,
  checkDir: string
): Validation {
  const tsc = resolveTsc(options.project, options.tsc);
  const packageDir = findPackageRoot(join(options.outDir, 'package.json'));
  if (!existsSync(join(packageDir, 'package.json'))) {
    throw new UsageFailure(`no package.json above ${options.outDir}`);
  }
  const routes = packetRoutes(packageDir, options.outDir);
  const probes = probeFiles(options.probesDir);
  mkdirSync(checkDir, { recursive: true });
  const project = join(checkDir, 'tsconfig.ordinary.json');
  writeCheckProject(
    project,
    options.project,
    probes,
    routePaths(routes, options.declDir)
  );
  const run = runCompiler(tsc, project, true);
  // Awaited by validate or by the cleanup; never an unhandled rejection.
  run.catch(() => undefined);
  return {
    tsc,
    routes,
    probes,
    packageDir,
    ordinary: { label: 'ordinary', root: options.declDir, other: staging, run },
  };
}

function auditLoaded(
  route: ProbeRoute,
  run: CompilerRun,
  packageDir: string,
  options: TypesAliasOptions
): string[] {
  const problems: string[] = [];
  if (!run.files.some((file) => isPathWithinRoot(route.root, file))) {
    problems.push(`${route.label} probes loaded nothing from ${route.root}`);
  }
  for (const file of run.files) {
    if (
      isPathWithinRoot(route.root, file) ||
      isPathWithinRoot(options.probesDir, file)
    )
      continue;
    if (
      isPathWithinRoot(route.other, file) ||
      isPathWithinRoot(options.outDir, file)
    ) {
      problems.push(`${route.label} probes loaded ${file} from another route`);
    } else if (
      isPathWithinRoot(packageDir, file) &&
      !DECLARATION_FILE.test(file) &&
      !file.split(sep).includes('node_modules')
    ) {
      problems.push(`${route.label} probes loaded package source ${file}`);
    }
  }
  return problems;
}

async function validate(
  options: TypesAliasOptions,
  staging: string,
  checkDir: string,
  packet: StagedPacket,
  validation: Validation
): Promise<{
  probes: { files: number; diagnostics: number };
  augmentationGaps: string[];
}> {
  const { tsc, routes, probes, packageDir, ordinary } = validation;
  for (const route of routes) {
    if (!route.target.includes('*') && !packet.files.has(route.target)) {
      throw new Error(
        `exports routes ${route.specifier} to ${route.target}, which the packet does not contain`
      );
    }
  }
  const identityChecks = writeIdentityChecks(staging, packet);
  const packetProject = join(checkDir, 'tsconfig.packet.json');
  writeCheckProject(
    packetProject,
    options.project,
    [
      ...[...packet.files.keys()]
        .filter((rel) => DECLARATION_FILE.test(rel))
        .map((rel) => join(staging, rel)),
      ...identityChecks,
    ],
    null
  );
  const aliasedProject = join(checkDir, 'tsconfig.aliased.json');
  writeCheckProject(
    aliasedProject,
    options.project,
    probes,
    routePaths(routes, staging)
  );
  const aliased: ProbeRoute = {
    label: 'aliased',
    root: staging,
    other: options.declDir,
    run: runCompiler(tsc, aliasedProject, true),
  };
  const [packetRun, ordinaryRun, aliasedRun] = await Promise.all([
    runCompiler(tsc, packetProject, false),
    ordinary.run,
    aliased.run,
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
  const problems: string[] = [];
  const probeSites = (route: ProbeRoute, run: CompilerRun): Set<string> => {
    problems.push(...auditLoaded(route, run, packageDir, options));
    const sites = new Set<string>();
    for (const diagnostic of run.diagnostics) {
      if (
        diagnostic.file !== null &&
        isPathWithinRoot(options.probesDir, diagnostic.file)
      ) {
        sites.add(
          `${diagnostic.file}(${diagnostic.line},${diagnostic.column}) ${diagnostic.code}`
        );
      } else {
        problems.push(`${route.label} route: ${formatDiagnostic(diagnostic)}`);
      }
    }
    return sites;
  };
  const ordinarySites = probeSites(ordinary, ordinaryRun);
  const aliasedSites = probeSites(aliased, aliasedRun);
  for (const site of ordinarySites) {
    if (!aliasedSites.has(site))
      problems.push(`only the ordinary declarations report ${site}`);
  }
  for (const site of aliasedSites) {
    if (!ordinarySites.has(site))
      problems.push(`only the packet reports ${site}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `the packet does not check as the ordinary declarations do:\n  ${problems.slice(0, 20).join('\n  ')}`
    );
  }
  return {
    probes: { files: probes.length, diagnostics: aliasedSites.size },
    augmentationGaps: augmentationGaps(packet, routes),
  };
}

// ---------------------------------------------------------------------------
// Promotion

/** Rename the staged packet into place. Between the two renames `--out` is
 *  absent, which fails a consumer loudly rather than serving a mix. */
function promote(staging: string, outDir: string): void {
  const retired = sideDirectory(outDir, 'retired');
  const replacing = existsSync(outDir);
  if (replacing) renameSync(outDir, retired);
  try {
    renameSync(staging, outDir);
  } catch (error) {
    if (replacing) renameSync(retired, outDir);
    throw error;
  }
  if (replacing) rmSync(retired, { recursive: true, force: true });
}

export async function runTypesAlias(
  options: TypesAliasOptions
): Promise<TypesAliasReport> {
  const started = performance.now();
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
  reapAbandoned(options.outDir);
  assertReplaceable(options.outDir);

  const staging = sideDirectory(options.outDir, 'staging');
  const checkDir = sideDirectory(options.outDir, 'check');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  let validation: Validation | null = null;
  try {
    validation = startValidation(options, staging, checkDir);
    const packet = stagePacket(options, staging);
    const aliased = performance.now();
    const { probes, augmentationGaps: gaps } = await validate(
      options,
      staging,
      checkDir,
      packet,
      validation
    );
    const checked = performance.now();

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
    promote(staging, options.outDir);
    const promoted = performance.now();
    return {
      files: packet.files.size,
      inputBytes: packet.inputBytes,
      outputBytes: packet.outputBytes,
      aliases: packet.aliases,
      refusals: packet.refusals,
      probes,
      augmentationGaps: gaps,
      timings: {
        alias: aliased - started,
        check: checked - aliased,
        promote: promoted - checked,
        total: promoted - started,
      },
    };
  } finally {
    // A failure before the checks finish leaves the ordinary run going; it
    // writes into the check directory removed below.
    await validation?.ordinary.run.catch(() => undefined);
    rmSync(staging, { recursive: true, force: true });
    rmSync(checkDir, { recursive: true, force: true });
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
  for (const gap of report.augmentationGaps)
    lines.push(`[animus]   warning: ${gap}`);
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
