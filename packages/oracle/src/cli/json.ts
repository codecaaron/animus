import type { ScenarioPoint } from '../core/scenario';

export interface CliEnvelope {
  command: string;
  target?: string;
  at?: ScenarioPoint;
  result: unknown;
}

export const renderJson = (envelope: CliEnvelope): string =>
  `${JSON.stringify(envelope, null, 2)}\n`;
