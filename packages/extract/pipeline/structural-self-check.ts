import { ANIMUS_LAYERS, assembleStylesheet } from './assemble-stylesheet';
import { parseInternalWire } from './internal-wire';
import { NO_KIT_FILES } from './manifest-diagnostics';

import type { ExternalPackageOutcome } from './discover-packages';

export interface StructuralCheckInput {
  componentCount: number;
  variableCss: string;
  globalCss: string;
  componentCss: string;
  layers?: string[];
  assembledCss?: string;
  externalOutcomes?: readonly ExternalPackageOutcome[];
  /** The loaded theme's token → variable map. A theme that declares no
   *  variables emits no `:root` block; without the map, one is required. */
  variableMapJson?: string | null;
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
      // The coded line stands in for the discovery warning, which a host
      // that runs this check leaves out.
      failures.push(
        `include '${specifier}' resolved but discovered no component sources [${NO_KIT_FILES}]`
      );
    } else if (outcome === 'unresolvable') {
      failures.push(`include '${specifier}' could not be resolved`);
    }
  }

  const declaresVariables =
    input.variableMapJson == null ||
    Object.keys(
      parseInternalWire<Record<string, string>>(
        input.variableMapJson,
        "variableMapJson (the theme's token → variable map)"
      )
    ).length > 0;
  if (declaresVariables && !input.variableCss.includes(':root')) {
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
    // Each layer's block follows the blocks of the layers before it.
    const blocks = ANIMUS_LAYERS.map((layer) => ({
      layer,
      offset: assembled.search(new RegExp(`@layer\\s+${layer}\\s*\\{`)),
    })).filter(({ offset }) => offset !== -1);
    const misplaced = blocks.findIndex(
      ({ offset }, index) => index > 0 && offset <= blocks[index - 1].offset
    );
    if (misplaced !== -1) {
      const earlier = blocks[misplaced - 1];
      const later = blocks[misplaced];
      failures.push(
        `CSS layer ordering violated — @layer ${earlier.layer} (offset ${earlier.offset}) must precede @layer ${later.layer} (offset ${later.offset})`
      );
    }
  }

  return failures;
}
