# Increment 01: canonicalizer-inventory

## Scope

- **Registry row**: 01 · mode: inline · review: self
- **Resolves** (Decision Ledger rows): edge-case-handling (the inventory enumerates the real edge-case population; its findings either confirm the merge rules or spawn rows)
- **Authors** (spec requirements): none (tooling + inventory only)
- **Depends on**: none
- **Footprint**: `openspec/changes/restore-spec-tree-integrity/tools/**`
- **Pushes to a later increment**: write-mode application (inc 02); backfill (inc 03)

> Resolving signal that licensed creating this increment now: journal entry `2026-07-07 04:09 · envelope · signal` — exploration classification complete; this increment is safe-to-fix-now work.

## Context Capsule

- **Objective**: A re-runnable bun script that classifies every `openspec/specs/*/spec.md` (116 files) into canonical / wrapperless / delta / mixed / no-requirements, computes the canonicalized output for repairable files, and emits a JSON inventory plus human summary — WITHOUT writing in this increment (dry-run only). A unit-test file proves the transform on fixture strings before the tool ever reads the real tree.
- **In-scope guardrails** (from design.md Register):
  - G3: validate pass-count SHALL NOT decrease — check: `bunx openspec validate --all 2>&1 | tail -1` — STOP. (Baseline this increment: 37 passed. Dry-run must leave it unchanged.)
- **Requirements to draft**: none.
- **Existing spec context**: main-tree failure shapes documented in brainstorm.md §Background — 40 delta-header files, 70 wrapper-less files, 37 canonical passing.
- **Relevant resolved decisions**: D1: format repair only, requirement text verbatim. D2: ADDED→upsert, MODIFIED→upsert (full replacement text), REMOVED→drop+record, RENAMED→apply FROM/TO, duplicate names→last wins+record. D3: generated Purpose derives from capability name + existing requirement names. D4: tool lives at `openspec/changes/restore-spec-tree-integrity/tools/canonicalize.ts`.
- **In-scope North Star criteria**: NS1 (tree never gets worse), NS3 (mechanical, re-runnable).
- **Prohibitions**: no version-control commands; no writes outside the footprint plus this file; dry-run only — `openspec/specs/**` is untouched this increment.

## Plan

## Task 01.1: Transform unit tests (fixtures first)

**Files:**
- Create: `openspec/changes/restore-spec-tree-integrity/tools/canonicalize.test.ts`

- [x] **Step 1: Write failing tests against inline fixtures** (+5 edge-case tests added after inventory review: title-section hoisting ×2, Purpose-less Requirements file, h1-preamble prose, non-canonical classify)

```ts
import { describe, expect, test } from 'bun:test';
import { canonicalize, classify } from './canonicalize';

const WRAPPERLESS = `### Requirement: Alpha does a thing

The system SHALL alpha.

#### Scenario: Alpha happens

- **WHEN** alpha is requested
- **THEN** alpha SHALL occur
`;

const DELTA_ONLY = `## ADDED Requirements

### Requirement: Beta exists

The system SHALL beta.

#### Scenario: Beta happens

- **WHEN** beta runs
- **THEN** beta SHALL succeed

## MODIFIED Requirements

### Requirement: Beta exists

The system SHALL beta twice.

#### Scenario: Beta happens twice

- **WHEN** beta runs
- **THEN** beta SHALL succeed twice

## REMOVED Requirements

### Requirement: Gamma retired

**Reason**: obsolete
**Migration**: none
`;

const CANONICAL = `## Purpose

Existing purpose.

## Requirements

### Requirement: Delta stands

The system SHALL delta.

#### Scenario: Delta holds

- **WHEN** delta runs
- **THEN** delta SHALL hold
`;

const MIXED = CANONICAL + '\n## ADDED Requirements\n\n### Requirement: Epsilon added\n\nThe system SHALL epsilon.\n\n#### Scenario: Epsilon happens\n\n- **WHEN** epsilon runs\n- **THEN** epsilon SHALL happen\n';

describe('classify', () => {
  test('buckets each shape', () => {
    expect(classify(WRAPPERLESS)).toBe('wrapperless');
    expect(classify(DELTA_ONLY)).toBe('delta');
    expect(classify(CANONICAL)).toBe('canonical');
    expect(classify(MIXED)).toBe('mixed');
    expect(classify('just prose, no requirements')).toBe('no-requirements');
  });
});

describe('canonicalize', () => {
  test('wraps wrapperless text verbatim', () => {
    const out = canonicalize('alpha-cap', WRAPPERLESS);
    expect(out.text).toContain('## Purpose');
    expect(out.text).toContain('## Requirements');
    expect(out.text).toContain('### Requirement: Alpha does a thing');
    expect(out.text).toContain('The system SHALL alpha.');
  });

  test('merges deltas: MODIFIED wins, REMOVED recorded', () => {
    const out = canonicalize('beta-cap', DELTA_ONLY);
    expect(out.text).toContain('SHALL beta twice');
    expect(out.text).not.toContain('The system SHALL beta.\n');
    expect(out.text).not.toContain('## ADDED');
    expect(out.removed).toEqual(['Gamma retired']);
  });

  test('canonical file is idempotent', () => {
    const out = canonicalize('delta-cap', CANONICAL);
    expect(out.changed).toBe(false);
  });

  test('mixed file appends ADDED requirement into Requirements', () => {
    const out = canonicalize('mixed-cap', MIXED);
    expect(out.text).toContain('### Requirement: Epsilon added');
    expect(out.text).not.toContain('## ADDED');
    expect(out.text).toContain('Existing purpose.');
  });
});
```

- [x] **Step 2: Run tests, verify they fail (module missing)**

Run: `cd openspec/changes/restore-spec-tree-integrity/tools && bun test`
Expected: FAIL — cannot resolve `./canonicalize` — CONFIRMED (1 error); edge-case tests confirmed failing before their implementation too (5 pass / 4 fail)

## Task 01.2: The canonicalizer

**Files:**
- Create: `openspec/changes/restore-spec-tree-integrity/tools/canonicalize.ts`

- [x] **Step 3: Implement parse + classify + merge + emit** (as planned, plus inventory-driven extensions: `canonical` requires BOTH `## Purpose` and `## Requirements`; requirement-bearing title sections hoisted with intro prose as Purpose candidate; preamble prose sans-h1 as Purpose candidate; Purpose priority: existing > preamble > hoisted > derived)

```ts
// One-shot repair tool for the main spec tree. Dry-run by default; --write
// applies. Archived with this change; re-runnable at any time (idempotent).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Classification =
  | 'canonical' | 'wrapperless' | 'delta' | 'mixed' | 'no-requirements';

export interface Requirement { name: string; lines: string[]; hasScenario: boolean }
interface Section { header: string; lines: string[] }

const DELTA_HEADER = /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/;
const REQ_HEADER = /^### Requirement: (.+?)\s*$/;

function splitSections(text: string): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      current = { header: line.trim(), lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return { preamble, sections };
}

function parseRequirements(lines: string[]): Requirement[] {
  const reqs: Requirement[] = [];
  let cur: Requirement | null = null;
  for (const line of lines) {
    const m = line.match(REQ_HEADER);
    if (m) { cur = { name: m[1], lines: [], hasScenario: false }; reqs.push(cur); }
    else if (cur) {
      cur.lines.push(line);
      if (line.startsWith('#### Scenario:')) cur.hasScenario = true;
    }
  }
  for (const r of reqs) { // trim trailing blank lines
    while (r.lines.length && r.lines[r.lines.length - 1].trim() === '') r.lines.pop();
  }
  return reqs;
}

export function classify(text: string): Classification {
  const { preamble, sections } = splitSections(text);
  const hasDelta = sections.some((s) => DELTA_HEADER.test(s.header));
  const hasCanonical = sections.some((s) => s.header === '## Requirements');
  const bareReqs = parseRequirements(preamble).length > 0;
  const anyReqs = bareReqs || sections.some((s) => parseRequirements(s.lines).length > 0);
  if (!anyReqs) return 'no-requirements';
  if (hasDelta && (hasCanonical || preambleHasPurpose(text))) return 'mixed';
  if (hasDelta) return 'delta';
  if (hasCanonical) return 'canonical';
  return 'wrapperless';
}

function preambleHasPurpose(text: string): boolean {
  return splitSections(text).sections.some((s) => s.header === '## Purpose');
}

export interface Result {
  classification: Classification;
  changed: boolean;
  text: string;
  removed: string[];
  duplicates: string[];
  scenarioless: string[];
  unknownSections: string[];
}

export function canonicalize(capability: string, text: string): Result {
  const classification = classify(text);
  const { preamble, sections } = splitSections(text);
  const removed: string[] = [];
  const duplicates: string[] = [];
  const unknownSections: string[] = [];

  if (classification === 'canonical' || classification === 'no-requirements') {
    return { classification, changed: false, text, removed, duplicates,
             scenarioless: [], unknownSections };
  }

  // Ordered requirement map: base first, then deltas in document order.
  const order: string[] = [];
  const byName = new Map<string, Requirement>();
  const upsert = (r: Requirement) => {
    if (byName.has(r.name)) duplicates.push(r.name);
    else order.push(r.name);
    byName.set(r.name, r);
  };

  for (const r of parseRequirements(preamble)) upsert(r); // wrapperless bodies
  let purposeLines: string[] | null = null;
  const passthrough: Section[] = [];

  for (const s of sections) {
    const m = s.header.match(DELTA_HEADER);
    if (s.header === '## Purpose') { purposeLines = s.lines; continue; }
    if (s.header === '## Requirements') { for (const r of parseRequirements(s.lines)) upsert(r); continue; }
    if (!m) { passthrough.push(s); unknownSections.push(s.header); continue; }
    const kind = m[1];
    if (kind === 'ADDED' || kind === 'MODIFIED') {
      for (const r of parseRequirements(s.lines)) upsert(r);
    } else if (kind === 'REMOVED') {
      for (const r of parseRequirements(s.lines)) {
        removed.push(r.name);
        if (byName.delete(r.name)) order.splice(order.indexOf(r.name), 1);
      }
    } else if (kind === 'RENAMED') {
      const from = s.lines.join('\n').match(/FROM:\s*`?(?:### Requirement: )?([^`\n]+)`?/);
      const to = s.lines.join('\n').match(/TO:\s*`?(?:### Requirement: )?([^`\n]+)`?/);
      if (from && to && byName.has(from[1].trim())) {
        const r = byName.get(from[1].trim())!;
        byName.delete(from[1].trim());
        order[order.indexOf(from[1].trim())] = to[1].trim();
        byName.set(to[1].trim(), { ...r, name: to[1].trim() });
      } else unknownSections.push(`${s.header} (unparsed rename)`);
    }
  }

  const reqNames = order.filter((n) => byName.has(n));
  const purpose = purposeLines?.join('\n').trim() ||
    derivePurpose(capability, reqNames);
  const scenarioless = reqNames.filter((n) => !byName.get(n)!.hasScenario);

  const parts: string[] = ['## Purpose', '', purpose, '', '## Requirements', ''];
  for (const n of reqNames) {
    parts.push(`### Requirement: ${n}`);
    parts.push(...byName.get(n)!.lines, '');
  }
  for (const s of passthrough) parts.push(s.header, ...s.lines, '');
  const out = parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { classification, changed: out !== text, text: out, removed,
           duplicates, scenarioless, unknownSections };
}

function derivePurpose(capability: string, names: string[]): string {
  const shown = names.slice(0, 3).join('; ');
  const more = names.length > 3 ? `; and ${names.length - 3} more` : '';
  return `Requirements for the \`${capability}\` capability: ${shown}${more}.`;
}

// --- CLI ---
if (import.meta.main) {
  const write = process.argv.includes('--write');
  const root = join(import.meta.dir, '../../../..', 'openspec/specs');
  const inventory: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  for (const dir of readdirSync(root).sort()) {
    const file = join(root, dir, 'spec.md');
    if (!existsSync(file)) continue;
    const res = canonicalize(dir, readFileSync(file, 'utf8'));
    counts[res.classification] = (counts[res.classification] ?? 0) + 1;
    inventory.push({ capability: dir, ...res, text: undefined });
    if (write && res.changed) writeFileSync(file, res.text);
  }
  writeFileSync(join(import.meta.dir, 'inventory.json'),
    JSON.stringify(inventory, null, 2));
  console.log(`${write ? 'WROTE' : 'DRY-RUN'} —`,
    Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '));
}
```

- [x] **Step 4: Run tests, verify they pass**

Run: `cd openspec/changes/restore-spec-tree-integrity/tools && bun test`
Expected: PASS (5 tests) — ACTUAL: PASS, 9 tests (5 planned + 4 edge-case), 26 expects

## Task 01.3: Dry-run inventory over the real tree

- [x] **Step 5: Dry-run and inspect the inventory**

Run: `bun openspec/changes/restore-spec-tree-integrity/tools/canonicalize.ts`
Expected: sum 116 — ACTUAL: `DRY-RUN — wrapperless: 37, delta: 40, canonical: 37, no-requirements: 2` (canonical == validator-passing set, exact)

- [x] **Step 6: Review edge cases in inventory.json** — findings and dispositions:
  - 8 files with `## Requirements` but no `## Purpose` → classify tightened; tool now inserts Purpose (mechanical).
  - ~11 files hold requirements inside a `## <Name> Specification` title section → hoisting rule added (mechanical); header dropped when its content is fully hoisted.
  - 18 files carry `# h1` + intro prose preambles → prose preserved as Purpose (mechanical).
  - `includes-driven-discovery` uses `### REQ-n:` + `**Scenarios:**` dialect (1 file in tree) → hand edit in inc 02 with journal entry (NS3 exception path); no dialect handler for a population of one.
  - `content-migration` is a prose design doc, zero requirement blocks → untouched, triage residue.
  - Unparsed renames: none. Duplicates: none. Scenarioless: `color-mode-palette` (2), `responsive-shell-layout` (3) → will remain invalid post-repair; triage residue.

- [x] **Step 7: Confirm dry-run left the tree untouched**

Run: `git status --short openspec/specs/ | head -5`
Expected: empty output. — CONFIRMED (0 lines)

## Guardrail gate

- [x] G3: `bunx openspec validate --all 2>&1 | rg '^Totals:'` — result: PASS — `Totals: 38 passed, 80 failed (118 items)`: spec-side unchanged at 37 passed / 79 failed; the two deltas vs the exploration baseline are the two new change dirs themselves (this change validates, the proposal-stage `enforce-workspace-topology` does not yet). Note: plan's `tail -1` picked up a "Details:" hint line; `rg '^Totals:'` is the durable form — carried into inc 02/03 gates.

## Output contract

Inline mode — collapsed into the checklists above; edge-case findings go to the reorientation entry.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [x] No requirements authored (none owned by this increment)
- [x] Flipped `edge-case-handling` Ledger row to resolved (promoted as D6) in design.md
- [x] Reorientation entry written (full adversarial pass — first post-envelope increment)
- [x] Ticked registry row 01 in tasks.md
