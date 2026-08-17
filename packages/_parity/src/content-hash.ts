/**
 * Content identity for the parity oracle.
 *
 * Every value hashed here is a JSON document — a recorded baseline envelope, a
 * seam result, or a slice of one engine's surface — so `JsonValue` (the shared
 * verification vocabulary) is the domain these functions canonicalize over. A
 * keyed block is decided by `isJsonObject`'s representation tag rather than by
 * `typeof`, which also means the things `JSON.parse` cannot produce (callables,
 * boxed primitives, `Date`/`Map`) are outside the contract instead of being
 * silently key-copied.
 */
import { isJsonObject } from '@animus-ui/assertions';
import { createHash } from 'crypto';

import type { ArtifactClass, UnitSurface } from './types';
import type { JsonObject, JsonValue } from '@animus-ui/assertions';

export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isJsonObject(value)) {
    const output: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(value[key]);
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalPrettyJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

export function hashArtifact(
  surface: UnitSurface | undefined,
  artifact: ArtifactClass
): string {
  if (!surface) return sha256Json({ missing: true });
  switch (artifact) {
    case 'css':
    case 'css-validity':
      return sha256(surface.css);
    case 'code':
      return sha256Json({
        code: surface.code,
        hasComponents: surface.hasComponents,
      });
    case 'observables':
      return sha256Json({
        ...surface.observables,
        parseCount: surface.parseCount,
      });
    case 'diagnostics':
      return sha256Json(surface.diagnostics);
  }
}
