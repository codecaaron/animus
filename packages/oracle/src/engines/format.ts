/**
 * Presentation helpers shared by every engine.
 *
 * Nothing here decides semantics — these functions only turn substrate values
 * into the concrete numbers and phrases the probe envelope's `summary`,
 * `assumptions` and diff `context` fields are required to carry.
 */

import type { ScenarioCell, ScenarioPoint } from '../core/scenario';

export const describePoint = (point: ScenarioPoint): string => {
  const dims = Object.keys(point).sort();
  if (dims.length === 0) return 'the unconstrained point';
  return dims.map((dim) => `${dim} = ${String(point[dim])}`).join(', ');
};

export const describeCell = (cell: ScenarioCell): string => {
  const dims = Object.keys(cell.description).sort();
  if (dims.length === 0) return 'the whole declared domain';
  return dims.map((dim) => cell.description[dim]).join(', ');
};

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

export const listOf = (items: readonly string[]): string =>
  items.length === 0 ? 'none' : items.join(', ');
