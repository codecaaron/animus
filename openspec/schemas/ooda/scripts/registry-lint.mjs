#!/usr/bin/env node
// registry-lint.mjs — minimal token/reference integrity lint for the
// superpowers schema's Increment Registry (tasks.md) and its cross-artifact
// references. Ships with the schema (see DEF-1 in schema.yaml); verify §2
// runs it and treats ERRORs as EVIDENCE-GAPs.
//
// Usage: node registry-lint.mjs <change-dir>
//   <change-dir> = openspec/changes/<change-name> (defaults to cwd)
//
// Checks (minimal set — see DEF-1 for what remains deferred):
//   E1  registry row shape parses (checkbox, NN, mode/review, path|lazy|retired, fields)
//   E2  duplicate row numbers
//   E3  resolves: D<n> exists in design.md §Decisions; DEF-<n> exists in the Ledger
//   E4  authors: targets exist as `### Requirement:` headers in specs/ (or `—`)
//   E5  deps:/inputs: cite real sibling rows or well-formed change:/external: tokens
//   E6  lazy rows cite a DEF-<n> present in the Ledger
//   E7  non-lazy rows have their increment file; orphan increment files (warn)
//   E8  ticked rows carry `ticked:`/`retired` evidence (warn if absent — v4
//       grandfather); a CITED journal timestamp must exist in journal.md (error)
//   E9  inputs-timing: a packet file must not exist while an inputs: sibling is unticked
//   E10 guardrail Scope tokens parse; inc:<NN> names real rows
//   E11 gate:ops rows cite ops:OPS-<n> present in ops-runbook.md (error if ticked)
//
// Exit code: 1 if any ERROR, else 0. Warnings never fail the run.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.';
const problems = [];
const err = (msg) => problems.push({ level: 'ERROR', msg });
const warn = (msg) => problems.push({ level: 'WARN', msg });

const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);

const tasks = read('tasks.md');
if (tasks === null) {
  console.error(`ERROR tasks.md not found under ${dir} — nothing to lint`);
  process.exit(1);
}
const design = read('design.md') ?? '';
const journal = read('journal.md') ?? '';
const runbook = read('ops-runbook.md');

// ---- design.md reference sets ------------------------------------------------
const decisionIds = new Set([...design.matchAll(/^###\s+D(\d+)\b/gm)].map((m) => `D${m[1]}`));
const ledgerIds = new Set([...design.matchAll(/\|\s*(DEF-\d+)\s*\|/g)].map((m) => m[1]));

// ---- specs requirement headers ------------------------------------------------
const specHeaders = new Map(); // capability -> Set(requirement header)
const specsRoot = join(dir, 'specs');
if (existsSync(specsRoot)) {
  for (const cap of readdirSync(specsRoot, { withFileTypes: true })) {
    if (!cap.isDirectory()) continue;
    const spec = read(join('specs', cap.name, 'spec.md'));
    if (spec === null) continue;
    const headers = new Set(
      [...spec.matchAll(/^###\s+Requirement:\s*(.+?)\s*$/gm)].map((m) => m[1]),
    );
    specHeaders.set(cap.name, headers);
  }
}

// ---- parse registry rows ------------------------------------------------------
const lines = tasks.split('\n');
const rowList = []; // every parsed row, duplicates included — per-row checks run on ALL
const rows = new Map(); // NN -> first row with that number (existence lookups)
const crossCutting = [];
let section = 0;
lines.forEach((line, i) => {
  const n = i + 1;
  const h = line.match(/^##\s*(\d+)\./);
  if (h) { section = Number(h[1]); return; }
  const box = line.match(/^- \[( |x)\] (.+)$/);
  if (!box) return;
  if (section === 2) { crossCutting.push({ line, n, ticked: box[1] === 'x' }); return; }
  if (section !== 1) return;

  const m = line.match(
    /^- \[( |x)\] (\S+) \[mode:(inline|delegate) · review:(self|subagent|subagent-if-available)\] (.+)$/,
  );
  if (!m) { err(`tasks.md:${n} E1 row does not parse against the registry grammar`); return; }
  const [, tick, id, mode, review, rest] = m;
  if (rows.has(id)) err(`tasks.md:${n} E2 duplicate row number ${id}`);

  // split "<path-or-paren> — <fields>"
  let pathPart, fieldPart;
  if (rest.startsWith('(')) {
    const close = rest.indexOf(')');
    pathPart = close === -1 ? rest : rest.slice(0, close + 1);
    fieldPart = close === -1 ? '' : rest.slice(close + 1).replace(/^\s*—\s*/, '');
  } else {
    const sep = rest.indexOf(' — ');
    pathPart = sep === -1 ? rest : rest.slice(0, sep);
    fieldPart = sep === -1 ? '' : rest.slice(sep + 3);
  }
  const fields = {};
  for (const f of fieldPart.split(' · ')) {
    const fm = f.match(/^([a-z]+):\s*(.*)$/);
    if (fm) fields[fm[1]] = fm[2].trim();
  }
  const lazy = pathPart.match(/^\(lazy — blocked on:\s*(DEF-\d+)\s*\)$/);
  const retired = /^\(retired — journal .+\)$/.test(pathPart);
  const row = { id, n, ticked: tick === 'x', mode, review, pathPart, fields, lazy: lazy?.[1] ?? null, retired };
  rowList.push(row);
  if (!rows.has(id)) rows.set(id, row);

  for (const key of ['resolves', 'authors', 'deps', 'inputs', 'footprint']) {
    if (!(key in fields)) warn(`tasks.md:${n} E1 row ${id} missing "${key}:" field`);
  }
});
if (rowList.length === 0) warn('tasks.md E1 no section-1 registry rows found');

// ---- per-row reference checks --------------------------------------------------
const splitAuthors = (s) => {
  // split on commas, re-attaching fragments that don't start a new § token
  const parts = [];
  for (const piece of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (piece.startsWith('§') || parts.length === 0) parts.push(piece);
    else parts[parts.length - 1] += `, ${piece}`;
  }
  return parts;
};

for (const row of rowList) {
  const { id, n, fields } = row;

  for (const tok of (fields.resolves ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== '—')) {
    if (/^D\d+$/.test(tok)) {
      if (!decisionIds.has(tok)) err(`tasks.md:${n} E3 row ${id} resolves ${tok} — no "### ${tok}" in design.md`);
    } else if (/^DEF-\d+$/.test(tok)) {
      if (!ledgerIds.has(tok)) err(`tasks.md:${n} E3 row ${id} resolves ${tok} — not a Ledger row in design.md`);
    } else err(`tasks.md:${n} E3 row ${id} resolves "${tok}" — not a D<n>/DEF-<n> token`);
  }

  const authors = (fields.authors ?? '').trim();
  if (authors && authors !== '—' && !authors.startsWith('— (')) {
    for (const tok of splitAuthors(authors)) {
      const am = tok.match(/^§([\w-]+)\/(.+)$/);
      if (!am) { err(`tasks.md:${n} E4 row ${id} authors "${tok}" — not §<capability>/<Requirement>`); continue; }
      const [, cap, reqName] = am;
      const headers = specHeaders.get(cap);
      if (!headers) warn(`tasks.md:${n} E4 row ${id} authors §${cap}/… — specs/${cap}/spec.md not found (authored later by this row?)`);
      else if (!headers.has(reqName)) {
        if (row.ticked) err(`tasks.md:${n} E4 row ${id} ticked but "### Requirement: ${reqName}" missing from specs/${cap}/spec.md`);
        else warn(`tasks.md:${n} E4 row ${id} authors "${reqName}" not yet in specs/${cap}/spec.md (expected before tick)`);
      }
    }
  }

  for (const key of ['deps', 'inputs']) {
    for (const tok of (fields[key] ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== '—')) {
      if (/^\d+(\.\d+)?$/.test(tok)) {
        if (!rows.has(tok)) err(`tasks.md:${n} E5 row ${id} ${key} cites row ${tok} — no such registry row`);
      } else if (/^change:[\w-]+#[\w.-]+$/.test(tok) || /^external:[a-z0-9]+(-[a-z0-9]+)*$/.test(tok)) {
        // well-formed portfolio token
      } else if (tok.startsWith('external:')) {
        warn(`tasks.md:${n} E5 row ${id} ${key} "${tok}" — external gates use kebab-slugs (external:r2-listbucket-confirmed)`);
      } else err(`tasks.md:${n} E5 row ${id} ${key} "${tok}" — not a row number, change:<name>#<row>, or external:<kebab-slug>`);
    }
  }

  if (row.lazy && !ledgerIds.has(row.lazy)) {
    err(`tasks.md:${n} E6 lazy row ${id} blocked on ${row.lazy} — not a Ledger row in design.md`);
  }

  if (!row.lazy && !row.retired) {
    if (!/^increments\/.+\.md$/.test(row.pathPart)) {
      err(`tasks.md:${n} E1 row ${id} path "${row.pathPart}" — expected increments/<NN>-<slug>.md, (lazy — blocked on: DEF-<n>), or (retired — journal <ts>)`);
    } else if (!existsSync(join(dir, row.pathPart))) {
      err(`tasks.md:${n} E7 row ${id} names ${row.pathPart} but the file does not exist`);
    }
  }

  if (row.ticked && !row.retired) {
    const ts = fields.ticked;
    if (!ts) warn(`tasks.md:${n} E8 row ${id} is ticked with no "· ticked: <ts>" evidence (pre-v5 grandfather; add on next touch)`);
    else if (journal && !journal.includes(ts)) err(`tasks.md:${n} E8 row ${id} ticked cites "${ts}" — timestamp not found in journal.md`);
    else if (!journal) warn(`tasks.md:${n} E8 row ${id} ticked but journal.md is missing — cannot cross-check`);
  }

  // E9 inputs-timing: my packet must not predate unticked sibling inputs
  if (!row.lazy && !row.retired && existsSync(join(dir, row.pathPart))) {
    for (const tok of (fields.inputs ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+(\.\d+)?$/.test(s))) {
      const upstream = rows.get(tok);
      if (upstream && !upstream.ticked) {
        err(`tasks.md:${n} E9 row ${id} packet exists but inputs row ${tok} is unticked — packets must not predate their inputs' output contracts`);
      }
    }
  }
}

// ---- orphan increment files (E7 warn) -------------------------------------------
const incDir = join(dir, 'increments');
if (existsSync(incDir)) {
  const referenced = new Set(rowList.map((r) => r.pathPart));
  for (const f of readdirSync(incDir).filter((f) => f.endsWith('.md'))) {
    if (!referenced.has(`increments/${f}`)) warn(`increments/${f} E7 orphan packet — no registry row references it`);
  }
}

// ---- E10 guardrail scope tokens --------------------------------------------------
const registerSection = design.split(/^##\s+Guardrail Register\s*$/m)[1]?.split(/^##\s/m)[0] ?? '';
for (const gm of registerSection.matchAll(/^\|\s*(G\d+)\s*\|(.*)$/gm)) {
  const cells = gm[0].split('|').map((c) => c.trim());
  // cells: ['', ID, Invariant, Scope, On trip, Status, ''] (v4+ layout, no Check column)
  const scope = cells[3] ?? '';
  const gid = gm[1];
  if (/^(all|change-end)$/.test(scope) || /^footprint:.+$/.test(scope)) continue;
  const inc = scope.match(/^inc:([\d,.\s]+)$/);
  if (inc) {
    for (const nn of inc[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!rows.has(nn)) err(`design.md E10 guardrail ${gid} scope inc:${nn} — no such registry row`);
    }
  } else if (scope) {
    err(`design.md E10 guardrail ${gid} scope "${scope}" — not in {all, footprint:<glob>, inc:<NN,…>, change-end}`);
  }
}

// ---- E11 gate:ops runbook citations ----------------------------------------------
for (const cc of crossCutting) {
  if (!cc.line.includes('gate:ops')) continue;
  const report = cc.ticked ? err : warn;
  const opsTokens = [...cc.line.matchAll(/ops:(OPS-\d+)/g)].map((m) => m[1]);
  if (opsTokens.length === 0) {
    report(`tasks.md:${cc.n} E11 gate:ops row cites no ops:OPS-<n> runbook rows`);
    continue;
  }
  if (runbook === null) {
    report(`tasks.md:${cc.n} E11 gate:ops row cites ${opsTokens.join(', ')} but ops-runbook.md does not exist`);
    continue;
  }
  for (const t of opsTokens) {
    if (!runbook.includes(t)) report(`tasks.md:${cc.n} E11 gate:ops cites ${t} — not found in ops-runbook.md`);
  }
}

// ---- report ----------------------------------------------------------------------
for (const p of problems) console.log(`${p.level} ${p.msg}`);
const errors = problems.filter((p) => p.level === 'ERROR').length;
const warnings = problems.length - errors;
console.log(`registry-lint: ${errors} error(s), ${warnings} warning(s) — ${rowList.length} registry row(s), ${crossCutting.length} cross-cutting row(s)`);
process.exit(errors > 0 ? 1 : 0);
