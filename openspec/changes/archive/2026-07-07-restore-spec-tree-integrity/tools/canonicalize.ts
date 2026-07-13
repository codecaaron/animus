// One-shot repair tool for the main spec tree. Dry-run by default; --write
// applies. Archived with this change; re-runnable at any time (idempotent).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Classification =
  | 'canonical'
  | 'wrapperless'
  | 'delta'
  | 'mixed'
  | 'no-requirements';

export interface Requirement {
  name: string;
  lines: string[];
  hasScenario: boolean;
}

interface Section {
  header: string;
  lines: string[];
}

const DELTA_HEADER = /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/;
const REQ_HEADER = /^### Requirement: (.+?)\s*$/;

function splitSections(text: string): {
  preamble: string[];
  sections: Section[];
} {
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
    if (m) {
      cur = { name: m[1], lines: [], hasScenario: false };
      reqs.push(cur);
    } else if (cur) {
      cur.lines.push(line);
      if (line.startsWith('#### Scenario:')) cur.hasScenario = true;
    }
  }
  for (const r of reqs) {
    while (r.lines.length && r.lines[r.lines.length - 1].trim() === '')
      r.lines.pop();
  }
  return reqs;
}

export function classify(text: string): Classification {
  const { preamble, sections } = splitSections(text);
  const hasDelta = sections.some((s) => DELTA_HEADER.test(s.header));
  const hasCanonical = sections.some((s) => s.header === '## Requirements');
  const hasPurpose = sections.some((s) => s.header === '## Purpose');
  const bareReqs = parseRequirements(preamble).length > 0;
  const anyReqs =
    bareReqs || sections.some((s) => parseRequirements(s.lines).length > 0);
  if (!anyReqs) return 'no-requirements';
  if (hasDelta && (hasCanonical || hasPurpose)) return 'mixed';
  if (hasDelta) return 'delta';
  if (hasCanonical && hasPurpose) return 'canonical';
  return 'wrapperless';
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
    return {
      classification,
      changed: false,
      text,
      removed,
      duplicates,
      scenarioless: [],
      unknownSections,
    };
  }

  // Ordered requirement map: base first, then deltas in document order.
  const order: string[] = [];
  const byName = new Map<string, Requirement>();
  const upsert = (r: Requirement) => {
    if (byName.has(r.name)) duplicates.push(r.name);
    else order.push(r.name);
    byName.set(r.name, r);
  };

  for (const r of parseRequirements(preamble)) upsert(r);
  // Prose in the preamble before the first requirement (minus h1 title lines)
  // is the file's own description — the best Purpose candidate after an
  // explicit ## Purpose section.
  const preambleProse = proseBeforeFirstRequirement(preamble);
  let hoistedProse = '';
  let purposeLines: string[] | null = null;
  const passthrough: Section[] = [];

  for (const s of sections) {
    const m = s.header.match(DELTA_HEADER);
    if (s.header === '## Purpose') {
      purposeLines = s.lines;
      continue;
    }
    if (s.header === '## Requirements') {
      for (const r of parseRequirements(s.lines)) upsert(r);
      continue;
    }
    if (!m) {
      const sectionReqs = parseRequirements(s.lines);
      if (sectionReqs.length > 0) {
        // Title-style section (e.g. "## Foo Specification") holding the
        // requirement body: hoist requirements, keep its intro prose as a
        // Purpose candidate, drop the redundant header.
        for (const r of sectionReqs) upsert(r);
        if (!hoistedProse) hoistedProse = proseBeforeFirstRequirement(s.lines);
        unknownSections.push(`${s.header} (hoisted)`);
      } else {
        passthrough.push(s);
        unknownSections.push(s.header);
      }
      continue;
    }
    const kind = m[1];
    if (kind === 'ADDED' || kind === 'MODIFIED') {
      for (const r of parseRequirements(s.lines)) upsert(r);
    } else if (kind === 'REMOVED') {
      for (const r of parseRequirements(s.lines)) {
        removed.push(r.name);
        if (byName.delete(r.name)) order.splice(order.indexOf(r.name), 1);
      }
    } else if (kind === 'RENAMED') {
      const joined = s.lines.join('\n');
      const from = joined.match(/FROM:\s*`?(?:### Requirement: )?([^`\n]+)`?/);
      const to = joined.match(/TO:\s*`?(?:### Requirement: )?([^`\n]+)`?/);
      if (from && to && byName.has(from[1].trim())) {
        const fromName = from[1].trim();
        const toName = to[1].trim();
        const r = byName.get(fromName)!;
        byName.delete(fromName);
        order[order.indexOf(fromName)] = toName;
        byName.set(toName, { ...r, name: toName });
      } else unknownSections.push(`${s.header} (unparsed rename)`);
    }
  }

  const reqNames = order.filter((n) => byName.has(n));
  const purpose =
    purposeLines?.join('\n').trim() ||
    preambleProse ||
    hoistedProse ||
    derivePurpose(capability, reqNames);
  const scenarioless = reqNames.filter((n) => !byName.get(n)!.hasScenario);

  const parts: string[] = [
    '## Purpose',
    '',
    purpose,
    '',
    '## Requirements',
    '',
  ];
  for (const n of reqNames) {
    parts.push(`### Requirement: ${n}`);
    parts.push(...byName.get(n)!.lines, '');
  }
  for (const s of passthrough) parts.push(s.header, ...s.lines, '');
  const out =
    parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  return {
    classification,
    changed: out !== text,
    text: out,
    removed,
    duplicates,
    scenarioless,
    unknownSections,
  };
}

function proseBeforeFirstRequirement(lines: string[]): string {
  const prose: string[] = [];
  for (const line of lines) {
    if (REQ_HEADER.test(line)) break;
    if (line.startsWith('# ')) continue; // h1 title — the dir name already carries it
    prose.push(line);
  }
  return prose.join('\n').trim();
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
  // inventory.json is the preserved pre-repair triage artifact — only a
  // --write run may produce it. Dry-runs (including re-runs on the repaired
  // tree) go to inventory.dry.json so the artifact survives re-execution.
  const inventoryFile = write ? 'inventory.json' : 'inventory.dry.json';
  writeFileSync(
    join(import.meta.dir, inventoryFile),
    JSON.stringify(inventory, null, 2)
  );
  console.log(
    `${write ? 'WROTE' : 'DRY-RUN'} —`,
    Object.entries(counts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  );
}
