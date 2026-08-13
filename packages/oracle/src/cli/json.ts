/**
 * The machine surface: one JSON document per invocation, on stdout, and
 * nothing else.
 *
 * The wrapper carries the question (command, target, point) alongside the
 * answer because a `ProbeResult` names its world and its state by hash, not
 * the invocation that produced it — an agent replaying a transcript needs
 * both halves to know what was asked.
 */

import type { ScenarioPoint } from '../core/scenario';

export interface CliEnvelope {
  command: string;
  target?: string;
  at?: ScenarioPoint;
  result: unknown;
}

export const renderJson = (envelope: CliEnvelope): string =>
  `${JSON.stringify(envelope, null, 2)}\n`;
