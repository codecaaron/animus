/**
 * The human report (DESIGN §9.1-shaped): fixed, uppercase section headers, one
 * fact per line, and everything a fact rests on indented beneath it.
 *
 * No colour codes and no box drawing: the report is read as often by `grep`
 * and by an agent tailing stderr as by a person, so a section is found by its
 * header and a fact by its property name. Sections with nothing to say are
 * omitted rather than printed empty — except VERDICT and COVERAGE, whose
 * absence would itself be information.
 */

import { originEdge } from '../core/fact';
import { describeValue } from '../core/value';
import { describePoint } from '../engines/format';

import type { RenderFact, SourceRef } from '../core/fact';
import type { UnknownObligation } from '../core/obligation';
import type { ProbeResult } from '../core/probe';
import type { ScenarioPoint } from '../core/scenario';
import type { SemanticDiffEntry } from '../engines/diff';
import type { RenderEquivalence } from '../engines/equivalence';

export interface RenderContext {
  command: string;
  /** The resolved component id, when the command had a target. */
  target?: string;
  binding?: string;
  classes?: readonly string[];
  point?: ScenarioPoint;
}

const describeSource = (source: SourceRef | undefined): string | undefined => {
  if (source === undefined) return undefined;
  const span =
    source.span === undefined ? '' : `:${source.span[0]}-${source.span[1]}`;
  return `${source.file}${span}`;
};

const subjectLabel = (fact: RenderFact): string | undefined => {
  switch (fact.subject.kind) {
    case 'style-target':
      return undefined;
    case 'rule':
      return `rule ${fact.subject.rule}`;
    case 'declaration':
      return `declaration ${fact.subject.rule}#${fact.subject.property}`;
    case 'component':
      return `component ${fact.subject.component}`;
    case 'world':
      return 'world';
  }
};

const factLines = (fact: RenderFact): readonly string[] => {
  const origin = originEdge(fact);
  const source = describeSource(fact.provenance[0]);
  const subject = subjectLabel(fact);

  const head =
    `  ${fact.property}: ${describeValue(fact.value)}` +
    (origin === undefined ? '' : ` ← ${origin.ref}`) +
    (origin?.note === undefined ? '' : ` (${origin.note})`) +
    (source === undefined ? '' : ` @ ${source}`) +
    (subject === undefined ? '' : ` [${subject}]`);

  const lines = [head];
  for (const ref of fact.provenance.slice(1)) {
    if (ref.note !== undefined) lines.push(`      ${ref.note}`);
  }
  for (const edge of fact.derivation) {
    if (edge.kind === 'defeats') {
      lines.push(`      defeats ${edge.note ?? edge.ref}`);
    } else if (edge.kind === 'defeated-by') {
      lines.push(`      defeated by ${edge.ref} — ${edge.note ?? ''}`);
    } else if (edge.kind === 'derived-from' && edge.ref.startsWith('token:')) {
      lines.push(`      ${edge.ref} ${edge.note ?? ''}`.trimEnd());
    }
  }
  return lines;
};

const diffEntryLine = (entry: SemanticDiffEntry): string =>
  `  ${entry.property}: ${entry.kind} ${entry.before ?? '(unset)'} → ` +
  `${entry.after ?? '(unset)'} @ ${entry.context}`;

const obligationLines = (obligation: UnknownObligation): readonly string[] => [
  `  ${obligation.id} [${obligation.effectClass}] ${obligation.reason}`,
  `      origin ${describeSource(obligation.origin) ?? '(none)'}`,
  ...obligation.dischargeOptions.map(
    (option) =>
      `      discharge ${option.kind} ` +
      `(${option.automated ? 'automated' : 'manual'}) — ${option.description}`
  ),
];

const targetLines = (context: RenderContext): readonly string[] => {
  if (context.target === undefined) return [];
  const lines = [
    `TARGET ${context.binding ?? context.target} · ${context.target}`,
  ];
  if (context.point !== undefined) {
    lines.push(`  at      ${describePoint(context.point)}`);
  }
  if (context.classes !== undefined) {
    lines.push(`  classes ${context.classes.join(' ')}`);
  }
  return lines;
};

export const renderProbe = (
  result: ProbeResult,
  context: RenderContext
): string => {
  const lines: string[] = [
    `COMMAND ${context.command}`,
    ...targetLines(context),
  ];

  lines.push(`VERDICT ${result.verdict}`, `  ${result.summary}`);

  if (result.facts.length > 0) {
    lines.push('FACTS');
    for (const fact of result.facts) lines.push(...factLines(fact));
  }

  const diff = result.semanticDiff;
  if (diff !== undefined) {
    lines.push(
      `SEMANTIC DIFF (${diff.entries.length} entries; ` +
        `${diff.affectedContextClasses} of ` +
        `${diff.affectedContextClasses + diff.unaffectedContextClasses} ` +
        'context classes changed)'
    );
    for (const entry of diff.entries) lines.push(diffEntryLine(entry));
  }

  if (result.witnesses !== undefined && result.witnesses.length > 0) {
    lines.push('WITNESSES');
    for (const witness of result.witnesses) {
      lines.push(`  at ${describePoint(witness.point)}`);
      lines.push(`      ${witness.violation}`);
      if (witness.boundary !== undefined) {
        lines.push(`      boundary ${witness.boundary}`);
      }
    }
  }

  if (result.causalFindings !== undefined && result.causalFindings.length > 0) {
    lines.push('CAUSAL FINDINGS');
    for (const finding of result.causalFindings) {
      lines.push(`  ${finding.status} ${finding.subject}`);
      lines.push(`      ${finding.note}`);
    }
  }

  if (result.assumptions.length > 0) {
    lines.push('ASSUMPTIONS');
    for (const assumption of result.assumptions)
      lines.push(`  - ${assumption}`);
  }

  if (result.unknowns.length > 0) {
    lines.push('UNKNOWNS');
    for (const unknown of result.unknowns) {
      lines.push(...obligationLines(unknown));
    }
  }

  // A sweep (e.g. simulate's collateral pass) can evaluate more cells than
  // the focal domain holds; "133 of 6" would read as a defect.
  lines.push(
    'COVERAGE',
    result.coverage.cellsEvaluated > result.coverage.scenarioCells
      ? `  cells ${result.coverage.cellsEvaluated} evaluated ` +
          `(focal domain ${result.coverage.scenarioCells}; the rest is ` +
          'collateral sweep)'
      : `  cells ${result.coverage.cellsEvaluated} evaluated of ` +
          `${result.coverage.scenarioCells} in the domain`
  );
  if (result.coverage.outsideModel.length > 0) {
    lines.push('  outside model');
    for (const item of result.coverage.outsideModel) {
      lines.push(`    - ${item}`);
    }
  }

  if (result.nextOperations.length > 0) {
    lines.push('NEXT');
    for (const operation of result.nextOperations) {
      lines.push(
        `  ${operation.kind} [${operation.expectedInformationGain}] ` +
          operation.description
      );
    }
  }

  lines.push(`STATE ${result.probeStateId} · world ${result.worldId}`);
  if (result.previous !== undefined) {
    lines.push(`  previous ${result.previous}`);
  }

  return `${lines.join('\n')}\n`;
};

export const renderEquivalence = (
  equivalence: RenderEquivalence,
  context: RenderContext
): string => {
  const lines: string[] = [
    `COMMAND ${context.command}`,
    ...targetLines(context),
    `CLASSES ${equivalence.classes.length}`,
  ];

  for (const entry of equivalence.classes) {
    lines.push(
      `  ${entry.activeRuleFingerprint} ${entry.cellCount} cells — ` +
        entry.description
    );
    lines.push(`      representative ${describePoint(entry.representative)}`);
  }

  return `${lines.join('\n')}\n`;
};
