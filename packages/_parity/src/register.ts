/**
 * Intentional-divergence register: the only mechanism by which a divergence
 * may pass the gate. Entries carry a category (DEF-9 resolution); a
 * divergence with no covering ACTIVE entry fails the run.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { Divergence, RegisterEntry } from './types';

const REGISTER_PATH = join(import.meta.dirname, '../register.json');

export function loadRegister(): RegisterEntry[] {
  if (!existsSync(REGISTER_PATH)) return [];
  return JSON.parse(readFileSync(REGISTER_PATH, 'utf-8'));
}

export function matchRegister(
  divergences: Divergence[],
  register: RegisterEntry[]
): Divergence[] {
  return divergences.map((d) => {
    // Prefix semantics ONLY for entries ending '/'; otherwise exact — an
    // entry must not silently cover look-alike future units.
    const entry = register.find(
      (r) =>
        r.status === 'active' &&
        (r.unit.endsWith('/')
          ? d.unit.startsWith(r.unit)
          : r.unit === d.unit) &&
        (r.artifact === 'any' || r.artifact === d.artifact)
    );
    return entry ? { ...d, registered: entry } : d;
  });
}
