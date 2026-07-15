/**
 * Exact-content drift register. Active entries classify committed-baseline
 * drift only for privileged refresh; they never license live differentials or
 * make an ordinary stale-baseline run pass. Unknown categories and stale
 * active entries fail.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { Divergence, RegisterEntry } from './types';

const REGISTER_PATH = join(import.meta.dirname, '../register.json');
const REGISTER_CATEGORIES = new Set([
  'intentional-correctness',
  'ordering',
  'v1-feature-drift',
  'known-quirk',
]);

function hasKnownCategory(entry: RegisterEntry): boolean {
  return REGISTER_CATEGORIES.has(entry.category);
}

export function loadRegister(): RegisterEntry[] {
  if (!existsSync(REGISTER_PATH)) return [];
  return JSON.parse(readFileSync(REGISTER_PATH, 'utf-8'));
}

export function matchRegister(
  divergences: Divergence[],
  register: RegisterEntry[]
): Divergence[] {
  return divergences.map((d) => {
    const entry = register.find(
      (r) =>
        r.status === 'active' &&
        hasKnownCategory(r) &&
        !r.unit.endsWith('/') &&
        r.unit === d.unit &&
        r.artifact !== 'any' &&
        r.artifact === d.artifact &&
        r.baselineSha256 === d.baselineSha256 &&
        r.candidateSha256 === d.candidateSha256
    );
    return entry ? { ...d, registered: entry } : d;
  });
}

export function validateRegister(
  register: RegisterEntry[],
  divergences: Divergence[]
): string[] {
  const errors: string[] = [];
  const sha = /^[a-f0-9]{64}$/;
  for (const entry of register.filter((item) => item.status === 'active')) {
    const label = `${entry.unit} · ${entry.artifact}`;
    if (!hasKnownCategory(entry)) {
      errors.push(`active register row ${label} has unknown category`);
      continue;
    }
    if (entry.unit.endsWith('/') || entry.artifact === 'any') {
      errors.push(
        `active register row ${label} must name an exact unit and artifact`
      );
      continue;
    }
    if (
      !entry.baselineSha256 ||
      !entry.candidateSha256 ||
      !sha.test(entry.baselineSha256) ||
      !sha.test(entry.candidateSha256)
    ) {
      errors.push(`active register row ${label} must carry two SHA-256 values`);
      continue;
    }
    const matches = divergences.some(
      (divergence) =>
        divergence.unit === entry.unit &&
        divergence.artifact === entry.artifact &&
        divergence.baselineSha256 === entry.baselineSha256 &&
        divergence.candidateSha256 === entry.candidateSha256
    );
    if (!matches)
      errors.push(`active register row ${label} matches no current drift`);
  }
  return errors;
}
