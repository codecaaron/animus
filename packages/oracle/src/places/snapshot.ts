import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createAnimusHost } from '../host/animus/host';
import {
  COMMIT_FILE,
  loadAnimusArtifacts,
  MANIFEST_FILE,
  STYLESHEET_FILE,
} from '../host/animus/loader';
import { asManifest } from '../host/animus/manifest-types';
import { readSourceStructure } from './source';

import type {
  AnimusHost,
  AnimusHostInput,
  AnimusHostOptions,
} from '../host/animus/host';
import type {
  AnimusManifest,
  ManifestFileFacts,
  ManifestUsageFact,
} from '../host/animus/manifest-types';
import type { SourceRead } from './source';

export interface Snapshot {
  host: AnimusHost;
  manifest: AnimusManifest;
  generation: string | undefined;
  sourceRoot: string;
  fileFacts(file: string): ManifestFileFacts | undefined;
  files(): readonly string[];
  structureOf(file: string): StructureResult;
  revalidate(): SnapshotFreshness;
}

export type SnapshotFreshness =
  | { fresh: true }
  | { fresh: false; changed: readonly string[] };

export type StructureResult =
  | { ok: true; read: SourceRead }
  | {
      ok: false;
      reason: 'not-in-snapshot' | 'source-missing' | 'diverged';
      detail: string;
      divergences?: readonly string[];
    };

export interface SnapshotOptions {
  sourceRoot?: string;
  host?: AnimusHostOptions;
}

const tagOf = (fact: ManifestUsageFact): string | undefined => {
  const tag = fact.element?.tag;
  if (tag === undefined) return undefined;
  return tag.ident ?? tag.member;
};

const usageDivergences = (
  read: SourceRead,
  usage: readonly ManifestUsageFact[]
): string[] => {
  const divergences: string[] = [];
  const recorded = usage.filter((fact) => fact.element !== undefined);

  if (recorded.length !== read.elements.length) {
    divergences.push(
      `element count: manifest recorded ${recorded.length} JSX element(s), ` +
        `source now has ${read.elements.length}`
    );
    return divergences;
  }

  recorded.forEach((fact, index) => {
    const element = read.elements[index];
    const tag = tagOf(fact);
    if (tag !== element.tag) {
      divergences.push(
        `element ${index}: manifest recorded <${tag ?? '?'}>, source has ` +
          `<${element.tag}>`
      );
      return;
    }
    for (const attr of fact.element?.attrs ?? []) {
      const mine = element.attributes.find((a) => a.name === attr.name);
      if (mine === undefined) {
        divergences.push(
          `element ${index} <${element.tag}>: manifest recorded attribute ` +
            `'${attr.name}', source no longer has it`
        );
        continue;
      }
      if (attr.dynamic === true) {
        if (mine.kind === 'static') {
          divergences.push(
            `element ${index} <${element.tag}>: '${attr.name}' was dynamic ` +
              'at extraction, source now has a static value'
          );
        }
        continue;
      }
      if (attr.staticValue !== null && attr.staticValue !== undefined) {
        if (mine.kind !== 'static' || mine.value !== String(attr.staticValue)) {
          divergences.push(
            `element ${index} <${element.tag}>: '${attr.name}' was ` +
              `'${String(attr.staticValue)}' at extraction, source now has ` +
              (mine.kind === 'static' ? `'${String(mine.value)}'` : mine.kind)
          );
        }
      }
    }
  });

  return divergences;
};

const ARTIFACT_FILES = [MANIFEST_FILE, STYLESHEET_FILE, COMMIT_FILE] as const;

const artifactBytes = (
  dir: string
): ReadonlyMap<string, string | undefined> => {
  const bytes = new Map<string, string | undefined>();
  for (const name of ARTIFACT_FILES) {
    const path = join(dir, name);
    bytes.set(name, existsSync(path) ? readFileSync(path, 'utf8') : undefined);
  }
  return bytes;
};

export const loadSnapshot = (
  artifactsDir: string,
  options: SnapshotOptions = {}
): Snapshot => {
  const input = loadAnimusArtifacts(artifactsDir);
  const hostInput: AnimusHostInput = { ...input };
  if (options.host !== undefined) hostInput.options = options.host;
  const host = createAnimusHost(hostInput);
  const manifest = asManifest(input.manifest);
  const sourceRoot = resolve(options.sourceRoot ?? dirname(artifactsDir));
  const loadedBytes = artifactBytes(artifactsDir);
  const structures = new Map<
    string,
    { sourceText: string; result: StructureResult }
  >();

  const fileFacts = (file: string): ManifestFileFacts | undefined =>
    manifest.fileFacts?.[file];

  const structureOf = (file: string): StructureResult => {
    const facts = fileFacts(file);
    if (facts === undefined) {
      return {
        ok: false,
        reason: 'not-in-snapshot',
        detail:
          `${file} has no fileFacts in this snapshot — it was not part of ` +
          `the analyzed program (generation ${host.program.label ?? host.program.hash})`,
      };
    }
    const path = resolve(sourceRoot, file);
    if (!existsSync(path)) {
      structures.delete(file);
      return {
        ok: false,
        reason: 'source-missing',
        detail: `${file} resolves to ${path}, which does not exist`,
      };
    }
    const sourceText = readFileSync(path, 'utf8');
    const cached = structures.get(file);
    if (cached !== undefined && cached.sourceText === sourceText) {
      return cached.result;
    }

    const read = readSourceStructure(file, sourceText);
    const divergences = usageDivergences(read, facts.usage ?? []);
    const result: StructureResult =
      divergences.length === 0
        ? { ok: true, read }
        : {
            ok: false,
            reason: 'diverged',
            detail:
              `${file} no longer corresponds to this snapshot's ` +
              'generation — rebuild the artifacts or ask about the ' +
              'committed source',
            divergences,
          };
    structures.set(file, { sourceText, result });
    return result;
  };

  const revalidate = (): SnapshotFreshness => {
    const current = artifactBytes(artifactsDir);
    const changed = ARTIFACT_FILES.filter(
      (name) => current.get(name) !== loadedBytes.get(name)
    );
    return changed.length === 0 ? { fresh: true } : { fresh: false, changed };
  };

  return {
    host,
    manifest,
    generation: host.program.label,
    sourceRoot,
    fileFacts,
    files: () => Object.keys(manifest.fileFacts ?? {}),
    structureOf,
    revalidate,
  };
};
