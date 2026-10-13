import { existsSync, realpathSync } from 'fs';
import { dirname } from 'path';

import { parseInternalWire } from './internal-wire';
import { resolveAssetFile } from './resolve-asset';

/** The stylesheet plan a sealed system registers, as written in its file. */
export interface StylesheetPlan {
  version: 1;
  vendor: string[];
  vendorOptOut: string[];
}

/** A plan's files, absolute, in its order. */
export interface ResolvedStylesheetPlan {
  vendor: string[];
  optOut: Set<string>;
}

/** The plan the loader read off the system, or null when it has none. */
export function readStylesheetPlan(
  json: string | null | undefined
): StylesheetPlan | null {
  if (!json) return null;
  const plan = parseInternalWire<StylesheetPlan>(
    json,
    "stylesheetPlan (the sealed system's stylesheet plan)"
  );
  if (plan.version !== 1) {
    throw new Error(
      `[animus] the system's stylesheet plan is version ${String(plan.version)}; ` +
        'this host reads version 1 — rebuild against a matching @animus-ui/system.'
    );
  }
  return plan;
}

/**
 * The plan's files resolved from the system file's directory, as asset
 * specifiers are: a relative path, or a package's file, its `exports`
 * hiding it or not. A declared file must exist: the plan promises it
 * loads, so one that resolves to nothing fails here, naming it.
 */
export function resolveStylesheetPlan(
  plan: StylesheetPlan,
  systemFile: string
): ResolvedStylesheetPlan {
  const missing: string[] = [];
  // Canonical, as both hosts name a module: its real path.
  const files = (specifiers: string[]) =>
    specifiers.flatMap((specifier) => {
      const file = resolveAssetFile(specifier, dirname(systemFile));
      if (file === null || !existsSync(file)) {
        missing.push(specifier);
        return [];
      }
      return [realpathSync(file)];
    });
  const vendor = files(plan.vendor);
  const optOut = new Set(files(plan.vendorOptOut));
  if (missing.length > 0) {
    throw new Error(
      `[animus] ${systemFile} registers vendor stylesheets that resolve to no ` +
        `file: ${missing.join(', ')}. Name a package file or a path relative ` +
        'to the system file.'
    );
  }
  return { vendor: [...new Set(vendor)], optOut };
}
