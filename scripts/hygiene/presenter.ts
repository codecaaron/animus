#!/usr/bin/env bun
// scripts/hygiene/presenter.ts
//
// Pure analyzer of .hygiene/receipts.jsonl. Computes the cascade verdict
// (converged / cap-hit-clean / cap-hit-divergent), Layer D volume signal,
// and Layer C code-drift WARN — all derived from the receipt stream
// rather than scattered orchestrator counters.
//
// Outputs:
//   - prints summaryLines to stdout (one per line)
//   - writes .hygiene/verdict.json with the structured Verdict
//
// run.sh reads verdict.json for the suggestedExitCode and exits accordingly.
// Process exit here is 0 on a successful analyze; non-zero only on internal
// error (presenter does NOT propagate the cascade's verdict via its own exit).
//
// Usage:
//   bun run scripts/hygiene/presenter.ts [--cap=<N>]
//
// Cap is read from env (HYGIENE_ITERATIONS) or --cap= flag; defaults to 5.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Receipt } from './_receipts';

export type Convergence = 'converged' | 'cap-hit-clean' | 'cap-hit-divergent';

export interface LayerDVolume {
  files: number;
  exports: number;
}

export interface Verdict {
  convergence: Convergence;
  finalIteration: number;
  iterationCap: number;
  finalIterationDeletes: number;
  layerDVolume: LayerDVolume;
  codeDrift?: string[];
  suggestedExitCode: 0 | 1;
  summaryLines: string[];
}

export const LAYER_D_FILE_THRESHOLD = 1;
export const LAYER_D_EXPORT_THRESHOLD = 5;

const DEFAULT_RECEIPTS_PATH = '.hygiene/receipts.jsonl';
const DEFAULT_VERDICT_PATH = '.hygiene/verdict.json';
const DEFAULT_CAP = 5;

export function parseReceipts(jsonl: string): Receipt[] {
  const out: Receipt[] = [];
  const lines = jsonl.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (
        rec &&
        typeof rec === 'object' &&
        rec.v === 1 &&
        typeof rec.iter === 'number' &&
        typeof rec.layer === 'string' &&
        typeof rec.verb === 'string' &&
        typeof rec.target === 'string' &&
        typeof rec.kind === 'string'
      ) {
        out.push(rec as Receipt);
      }
    } catch {
      // Tolerate partial trailing line (e.g., SIGINT mid-write); skip silently.
    }
  }
  return out;
}

function partitionByIter(records: Receipt[]): Map<number, Receipt[]> {
  const m = new Map<number, Receipt[]>();
  for (const r of records) {
    const list = m.get(r.iter) ?? [];
    list.push(r);
    m.set(r.iter, list);
  }
  return m;
}

function deleteCount(records: Receipt[]): number {
  let n = 0;
  for (const r of records) {
    if (r.verb === 'delete') n++;
  }
  return n;
}

function divergentLayers(records: Receipt[]): Set<string> {
  const layers = new Set<string>();
  for (const r of records) {
    if (
      r.verb === 'delete' &&
      (r.layer === 'C' || r.layer === 'D' || r.layer === 'D1')
    ) {
      layers.add(r.layer);
    }
  }
  return layers;
}

function layerDVolume(records: Receipt[]): LayerDVolume {
  let files = 0;
  let exports_ = 0;
  for (const r of records) {
    if (r.layer !== 'D' || r.verb !== 'delete') continue;
    if (r.kind === 'file') files++;
    else if (r.kind === 'export-clause' || r.kind === 'export-default')
      exports_++;
  }
  return { files, exports: exports_ };
}

function codeDrift(records: Receipt[]): string[] | undefined {
  const seen = new Set<string>();
  for (const r of records) {
    if (r.verb !== 'drift-suspected') continue;
    const codes = r.extras?.codesSeen;
    if (Array.isArray(codes)) {
      for (const c of codes) {
        if (typeof c === 'string') seen.add(c);
      }
    }
  }
  return seen.size > 0 ? [...seen].sort() : undefined;
}

export function analyze(
  records: Receipt[],
  cap: number,
  ranIters?: number
): Verdict {
  const byIter = partitionByIter(records);
  const iters = [...byIter.keys()].sort((a, b) => a - b);
  const lastReceiptIter = iters.length > 0 ? iters[iters.length - 1] : 0;
  // The cascade may have run iterations beyond the last one that produced any
  // receipts (e.g., a clean iteration 2 with zero diagnostics emits no
  // records). Trust the orchestrator-supplied ranIters when it exceeds the
  // receipt-derived final iter — those silent iterations are convergence
  // evidence, not absence of evidence.
  const finalIteration =
    ranIters !== undefined && ranIters > lastReceiptIter
      ? ranIters
      : lastReceiptIter;
  const finalRecords =
    finalIteration > 0 ? (byIter.get(finalIteration) ?? []) : [];
  const finalIterationDeletes = deleteCount(finalRecords);

  let convergence: Convergence;
  if (finalIterationDeletes > 0) {
    // Divergent regardless of whether cap was actually hit — the spec frames
    // both as "cap-hit-divergent" because the user-facing semantics are the
    // same: cascade did not settle, manual review needed.
    convergence = 'cap-hit-divergent';
  } else if (finalIteration < cap) {
    convergence = 'converged';
  } else {
    convergence = 'cap-hit-clean';
  }

  const volume = layerDVolume(records);
  const drift = codeDrift(records);

  const summaryLines: string[] = [];

  if (convergence === 'converged') {
    if (finalIteration === 0) {
      summaryLines.push('converged immediately (no mutations)');
    } else {
      summaryLines.push(`converged in ${finalIteration} iteration(s)`);
    }
  } else if (convergence === 'cap-hit-clean') {
    summaryLines.push(
      'INFO: cascade settled at iteration cap (idempotent A/B churn caused fingerprint drift)'
    );
  } else {
    const layers = [...divergentLayers(finalRecords)].sort().join('/');
    summaryLines.push(
      `WARN: cascade did not converge — Layer ${layers || 'C/D/D1'} still deleting at iteration ${finalIteration}`
    );
  }

  if (
    volume.files >= LAYER_D_FILE_THRESHOLD ||
    volume.exports >= LAYER_D_EXPORT_THRESHOLD
  ) {
    summaryLines.push(
      `NOTE: Layer D removed ${volume.exports} exports / ${volume.files} files. Build-time consumers (vite virtual modules, MDX, custom plugins) are invisible to knip — run \`vp run verify:build:*\` before committing.`
    );
  }

  if (drift) {
    summaryLines.push(
      `WARN: oxlint diagnostics present but none matched known codes — oxlint may have renamed. Codes seen: ${drift.join(', ')}`
    );
  }

  const suggestedExitCode: 0 | 1 = convergence === 'cap-hit-divergent' ? 1 : 0;

  const verdict: Verdict = {
    convergence,
    finalIteration,
    iterationCap: cap,
    finalIterationDeletes,
    layerDVolume: volume,
    suggestedExitCode,
    summaryLines,
  };
  if (drift) verdict.codeDrift = drift;
  return verdict;
}

function parseFlag(name: string): number | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      const n = Number(arg.slice(prefix.length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function parseCap(): number {
  const flag = parseFlag('cap');
  if (flag !== undefined) return flag;
  const env = Number(process.env.HYGIENE_ITERATIONS ?? '');
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_CAP;
}

function parseRanIters(): number | undefined {
  const flag = parseFlag('final-iter');
  if (flag !== undefined) return flag;
  const env = Number(process.env.HYGIENE_FINAL_ITER ?? '');
  if (Number.isFinite(env) && env > 0) return env;
  return undefined;
}

function main(): void {
  const cap = parseCap();
  const ranIters = parseRanIters();
  const receiptsPath = process.env.RECEIPTS_FILE || DEFAULT_RECEIPTS_PATH;

  let records: Receipt[];
  if (existsSync(receiptsPath)) {
    const raw = readFileSync(receiptsPath, 'utf-8');
    records = parseReceipts(raw);
  } else {
    records = [];
  }

  const verdict = analyze(records, cap, ranIters);

  for (const line of verdict.summaryLines) console.log(line);

  const verdictPath = process.env.VERDICT_FILE || DEFAULT_VERDICT_PATH;
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf-8');
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  }
}
