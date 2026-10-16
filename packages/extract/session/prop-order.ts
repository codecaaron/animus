/**
 * The prop-order file the `animus/prop-order` Oxlint rule reads: each
 * analysed component's accepted props in authoring order, each tag a file
 * writes that renders one of them, and the content hash of every file the
 * analysis read, which the rule compares with the disk before it trusts
 * the rest. Loads nothing of the engine or the session: the lint rule
 * imports it.
 */

import { relative, sep } from 'path';

import type {
  ManifestOrderedProp,
  ProjectManifest,
} from '../pipeline/manifest-schema';

/** Bumped when the file's shape or its order's meaning changes. */
export const PROP_ORDER_SCHEMA_VERSION = 2;

export interface PropOrderFile {
  schemaVersion: number;
  /** Root-relative path, `/`-separated → the md5 of the text the analysis
   *  read, or '' for a system input that was absent. */
  files: Record<string, string>;
  /** Component id → its accepted props, by rank. */
  components: Record<string, ManifestOrderedProp[]>;
  /** Root-relative path → tag as written there → component id. */
  tags: Record<string, Record<string, string>>;
}

export const posixPath = (path: string): string => path.split(sep).join('/');

/**
 * The file for one analysis: its analysed sources, by root-relative path,
 * and the other files its result depends on, by absolute path. A file an
 * adapter rewrote before analysis (MDX, Svelte) is analysed under another
 * path, which no disk file hashes to, so the stamp and the tags leave it
 * out.
 */
export function buildPropOrderFile(
  rootDir: string,
  manifest: ProjectManifest,
  analysed: ReadonlyArray<{ path: string; hash: string }>,
  witnesses: ReadonlyMap<string, string>,
  adapted: ReadonlyMap<string, readonly string[]>
): PropOrderFile {
  const adaptedPaths = new Set([...adapted.values()].flat());
  const files: Record<string, string> = {};
  for (const { path, hash } of analysed) {
    if (!adaptedPaths.has(path)) files[posixPath(path)] = hash;
  }
  for (const [path, hash] of witnesses) {
    files[posixPath(relative(rootDir, path))] = hash;
  }
  const components: Record<string, ManifestOrderedProp[]> = {};
  for (const [id, descriptor] of Object.entries(manifest.components)) {
    components[id] = descriptor.authoring_order ?? [];
  }
  const tags: Record<string, Record<string, string>> = {};
  for (const [path, written] of Object.entries(manifest.tag_components ?? {})) {
    if (!adaptedPaths.has(path)) tags[posixPath(path)] = written;
  }
  return { schemaVersion: PROP_ORDER_SCHEMA_VERSION, files, components, tags };
}

/** A value JSON can hold. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// A JSON value's kind, without `typeof`: a string, a number and an object
// are each the only JSON values equal to their own conversion.
const isText = (value: JsonValue | undefined): value is string =>
  String(value) === value;
const isCount = (value: JsonValue | undefined): value is number =>
  Number(value) === value;
const isObject = (
  value: JsonValue | undefined
): value is { [key: string]: JsonValue } =>
  Object(value) === value && !Array.isArray(value);

const STAGES: ReadonlyArray<ManifestOrderedProp['stage']> = [
  'variants',
  'states',
  'system',
  'custom',
];

function decodeOrderedProp(value: JsonValue): ManifestOrderedProp | null {
  if (!isObject(value) || !isText(value.name) || !isCount(value.rank)) {
    return null;
  }
  const stage = STAGES.find((known) => known === value.stage);
  if (stage === undefined) return null;
  if (value.forwarded !== undefined && value.forwarded !== true) return null;
  const prop: ManifestOrderedProp = {
    name: value.name,
    stage,
    rank: value.rank,
  };
  if (value.forwarded === true) prop.forwarded = true;
  return prop;
}

/** A JSON object whose every value is a string, or null. */
function decodeTextRecord(
  value: JsonValue | undefined
): Record<string, string> | null {
  if (!isObject(value)) return null;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isText(entry)) return null;
    record[key] = entry;
  }
  return record;
}

/** The prop-order file `text` holds, or null when it holds anything else:
 *  JSON of another shape, or not JSON. */
export function decodePropOrderFile(text: string): PropOrderFile | null {
  let value: JsonValue;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || !isCount(value.schemaVersion)) return null;
  const files = decodeTextRecord(value.files);
  if (files === null || !isObject(value.components) || !isObject(value.tags)) {
    return null;
  }
  const components: Record<string, ManifestOrderedProp[]> = {};
  for (const [id, props] of Object.entries(value.components)) {
    if (!Array.isArray(props)) return null;
    const decoded = props.map(decodeOrderedProp);
    if (decoded.includes(null)) return null;
    components[id] = decoded.filter((prop) => prop !== null);
  }
  const tags: Record<string, Record<string, string>> = {};
  for (const [file, written] of Object.entries(value.tags)) {
    const decoded = decodeTextRecord(written);
    if (decoded === null) return null;
    tags[file] = decoded;
  }
  return { schemaVersion: value.schemaVersion, files, components, tags };
}
