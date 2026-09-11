import { appendFileSync } from 'node:fs';

import type { JsonObject } from '@animus-ui/assertions';

export type ReceiptLayer = 'A' | 'C' | 'D' | 'D1';
export type ReceiptVerb = 'delete' | 'format' | 'stub' | 'drift-suspected';

export interface Receipt {
  v: 1;
  iter: number;
  layer: ReceiptLayer;
  verb: ReceiptVerb;
  target: string;
  kind: string;
  extras?: JsonObject;
}

const RECEIPTS_FILE = process.env.RECEIPTS_FILE ?? '';
const HYGIENE_ITER = Number(process.env.HYGIENE_ITER ?? '0');

export function emitReceipt(
  layer: ReceiptLayer,
  verb: ReceiptVerb,
  target: string,
  kind: string,
  extras?: JsonObject
): void {
  if (!RECEIPTS_FILE) return;
  const record: Receipt = {
    v: 1,
    iter: HYGIENE_ITER,
    layer,
    verb,
    target,
    kind,
  };
  if (extras !== undefined) record.extras = extras;
  appendFileSync(RECEIPTS_FILE, `${JSON.stringify(record)}\n`, 'utf-8');
}
