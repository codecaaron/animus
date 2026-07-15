import { createHash } from 'crypto';

import type { ArtifactClass, UnitSurface } from './types';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = canonicalize(input[key]);
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalPrettyJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value: unknown): string {
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
