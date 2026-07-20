import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LaneReceipt {
  lane: string;
  host: 'vite' | 'next';
  hostVersion: string;
  mode: 'production' | 'dev';
  engineLoaded: 'v2';
  engineDefault: 'v2';
  engineOverride: boolean;
  packageForm: 'workspace' | 'packed';
}

export function writeLaneReceipt(path: string, receipt: LaneReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
}
