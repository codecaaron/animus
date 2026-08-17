// scripts/hygiene/_receipts.ts
//
// Shared deletion-receipt emitter for the code-hygiene cascade. Used by
// delete-unused.ts (Layer C), reconcile-after-knip.ts (Layer D1),
// _emit-oxlint-receipts.ts (Layer A), and _emit-knip-receipts.ts (Layer D)
// to append v1-schema records to .hygiene/receipts.jsonl as the cascade
// applies layers.
//
// Layer B was removed in Phase β (oxlint's no-unused-private-class-members
// fires only on `#field` syntax, not the TS `private` keyword Animus uses).
// Cascade is now A → C → D → D1.
//
// Receipts file is truncated by run.sh at orchestrator startup; this module
// only appends. RECEIPTS_FILE and HYGIENE_ITER are read from env per run.
// When RECEIPTS_FILE is unset (e.g., direct script invocation in a test)
// emitReceipt is a no-op.

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
  // Layer-specific metadata. A receipt is a JSONL line, so `extras` is a JSON
  // document by construction — the repo's shared JSON vocabulary is what says
  // so, and it is what the presenter decodes the line back through.
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
  // An ABSENT `extras` key means the layer recorded no layer-specific metadata
  // for this operation — which readers distinguish from a present-but-empty
  // `{}`, so the key is written only when the caller supplied one.
  if (extras !== undefined) record.extras = extras;
  appendFileSync(RECEIPTS_FILE, `${JSON.stringify(record)}\n`, 'utf-8');
}
