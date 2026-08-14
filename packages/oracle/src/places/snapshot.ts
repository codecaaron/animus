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

import type { AnimusHost, AnimusHostOptions } from '../host/animus/host';
import type {
  AnimusManifest,
  ManifestFileFacts,
  ManifestUsageFact,
} from '../host/animus/manifest-types';
import type { SourceRead } from './source';

/**
 * A Snapshot binds one artifact set to one source tree generation
 * (PLACES.md §2). Every fact the places layer produces is scoped to it; two
 * snapshots never mix.
 */
export interface Snapshot {
  host: AnimusHost;
  manifest: AnimusManifest;
  /** `animus-commit:<hash>` when the artifact set carried a commit record. */
  generation: string | undefined;
  /** The directory the manifest's file keys are relative to. */
  sourceRoot: string;
  fileFacts(file: string): ManifestFileFacts | undefined;
  /** Every manifest file key that has facts. */
  files(): readonly string[];
  /**
   * Structure of one file, correspondence-checked against the manifest's
   * usage record for that file (PLACES.md §1). A refusal is an answer about
   * generations, not an error: the working tree no longer matches the
   * program the artifacts describe, and mixing them would produce facts
   * about a program that never existed.
   *
   * The check holds over time (PLACES.md §6): the file is re-read on every
   * call, so a warm process answers about the file as it is NOW — an edit
   * after load flips the answer to `diverged`, and a revert restores it.
   */
  structureOf(file: string): StructureResult;
  /**
   * Is the loaded artifact set still the one on disk? A rebuilt `.animus`
   * directory means this snapshot describes a dead generation — a warm
   * consumer must refuse or reload, never keep answering from it.
   */
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
  /** Defaults to the artifact directory's parent — where `animus build` ran. */
  sourceRoot?: string;
  host?: AnimusHostOptions;
}

const tagOf = (fact: ManifestUsageFact): string | undefined => {
  const tag = fact.element?.tag;
  if (tag === undefined) return undefined;
  return tag.ident ?? tag.member;
};

/**
 * Project a fresh structural read onto the manifest's flat usage sequence.
 * Agreement is the per-file correspondence witness; any disagreement means
 * the file drifted since extraction. Only the manifest's knowledge is
 * checked — the structural read legitimately sees more (spreads, skipped
 * attributes), and extra knowledge is not drift.
 */
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

/** The artifact files whose bytes define the loaded generation. */
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
  const host = createAnimusHost({
    ...input,
    ...(options.host === undefined ? {} : { options: options.host }),
  });
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
    // The cache is keyed by content, not by time: the file is re-read on
    // every call, and only an unchanged read reuses the parsed result. This
    // is what keeps a warm process honest — correspondence is a property of
    // the file as it is now, not of the session's first look at it.
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
