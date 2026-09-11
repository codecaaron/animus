import { assembleStylesheet } from './assemble-stylesheet';

import type { ExternalPackageOutcome } from './discover-packages';

export interface StructuralCheckInput {
  componentCount: number;
  variableCss: string;
  globalCss: string;
  componentCss: string;
  layers?: string[];
  assembledCss?: string;
  externalOutcomes?: readonly ExternalPackageOutcome[];
}

export function runStructuralSelfCheck(input: StructuralCheckInput): string[] {
  const failures: string[] = [];

  if (input.componentCount === 0) {
    failures.push(
      'No component CSS produced — check the system file and its includes list'
    );
  } else {
    // In assembled mode the witness is the `anm-base` block, not the `@layer`
    // declaration line, which is present even when nothing was emitted.
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
