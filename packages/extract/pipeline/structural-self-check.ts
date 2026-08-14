/**
 * Structural self-check over an emitted extraction result — the affirmative
 * post-condition against silent-empty output (openspec:
 * standalone-extraction-cli, "Silent-empty success is impossible").
 *
 * One shared implementation for every driver: the Vite plugin's `verify`
 * option and the standalone CLI (default-on) both call this; the caller
 * owns the failure POLICY (warn vs throw vs exit code), never the checks.
 */

import { assembleStylesheet } from './assemble-stylesheet';

import type { ExternalPackageOutcome } from './discover-packages';

export interface StructuralCheckInput {
  /** Number of components in the manifest. */
  componentCount: number;
  /** The theme's variable CSS (`:root` block expected). */
  variableCss: string;
  /** Global CSS (may be empty). */
  globalCss: string;
  /** Resolved component CSS (post transform substitution). */
  componentCss: string;
  /** Consumer `layers` option, when configured. */
  layers?: string[];
  /** An already-assembled full sheet — when provided, the ordering and
   *  placeholder checks run on it directly instead of re-assembling from
   *  the pieces (the CLI holds only the final sheet). */
  assembledCss?: string;
  /** Per-specifier discovery outcomes from the last collection. */
  externalOutcomes?: readonly ExternalPackageOutcome[];
}

/** Run every structural check; returns human-readable failure lines
 *  (empty = pass). */
export function runStructuralSelfCheck(input: StructuralCheckInput): string[] {
  const failures: string[] = [];

  if (input.componentCount === 0) {
    failures.push(
      'No component CSS produced — check the system file and its includes list'
    );
  } else {
    // Components discovered but component CSS empty — the inverse
    // emptiness (openspec: standalone-extraction-cli, "Structural
    // emptiness is fatal"). In piece mode the component CSS itself is
    // testable; in assembled mode the anm-base BLOCK (not the @layer
    // declaration line) is the witness.
    const componentCssEmpty =
      input.assembledCss !== undefined
        ? !/@layer\s+anm-base\s*\{/.test(input.assembledCss)
        : input.componentCss.trim().length === 0;
    if (componentCssEmpty) {
      failures.push(
        `${input.componentCount} component(s) discovered but the emitted component CSS is empty`
      );
    }
  }

  for (const { specifier, outcome } of input.externalOutcomes ?? []) {
    if (outcome === 'empty') {
      failures.push(
        `include '${specifier}' resolved but discovered no component sources`
      );
    } else if (outcome === 'unresolvable') {
      failures.push(`include '${specifier}' could not be resolved`);
    }
  }

  if (!input.variableCss.includes(':root')) {
    failures.push('No :root variable block found in variable CSS');
  }

  const combined =
    input.assembledCss ??
    `${input.variableCss}\n${input.globalCss}\n${input.componentCss}`;
  if (combined.includes('__TRANSFORM__')) {
    failures.push('Unresolved __TRANSFORM__ placeholders found in CSS output');
  }

  if (
    input.componentCount > 0 &&
    (input.componentCss.length > 0 || input.assembledCss !== undefined)
  ) {
    const assembled =
      input.assembledCss ??
      assembleStylesheet({
        layers: input.layers,
        variableCss: input.variableCss,
        globalCss: input.globalCss,
        componentCss: input.componentCss,
      });
    const baseIdx = assembled.search(/@layer\s+anm-base\s*\{/);
    const variantsIdx = assembled.search(/@layer\s+anm-variants\s*\{/);
    if (baseIdx !== -1 && variantsIdx !== -1 && baseIdx >= variantsIdx) {
      failures.push(
        `CSS layer ordering violated — @layer anm-base (offset ${baseIdx}) must precede @layer anm-variants (offset ${variantsIdx})`
      );
    }
  }

  return failures;
}
