import browserslist from 'browserslist';
import {
  browserslistToTargets,
  Features,
  transform as lcssTransform,
} from 'lightningcss';

import { LOWERED_DIR_SELECTOR, severityFor } from './manifest-diagnostics';

import type { ManifestDiagnostic } from './manifest-diagnostics';

export type LightningTargets = ReturnType<typeof browserslistToTargets>;

export function resolveLightningTargets(
  explicitTargets: string | string[] | undefined,
  rootDir: string
): LightningTargets {
  // Explicit targets always resolve: a one-word query such as 'defaults' is
  // no browser id, and a resolved id ('chrome 120') resolves to itself.
  if (explicitTargets) {
    return browserslistToTargets(browserslist(explicitTargets));
  }
  const detected = browserslist(undefined, { path: rootDir });
  return browserslistToTargets(
    detected.length > 0 ? detected : browserslist('defaults')
  );
}

export function postProcessCss(
  css: string,
  opts: {
    minify: boolean;
    targets: LightningTargets;
    /** Keeps `:dir()` as written where the targets would lower it. */
    keepDirSelector?: boolean;
    warnFn?: (msg: string) => void;
    /** Called when the targets lowered an authored `:dir()`. */
    onLoweredDir?: () => void;
  }
): string {
  if (!css) return css;
  let code: string;
  try {
    code = lcssTransform({
      filename: 'animus-extracted.css',
      code: Buffer.from(css),
      minify: opts.minify,
      targets: opts.targets,
      ...(opts.keepDirSelector && keptDirFeatures()),
    }).code.toString();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
  // Lightning CSS lowers every `:dir()` for a target or none. Outside the
  // try, so a report at error level fails the build.
  if (
    opts.onLoweredDir &&
    !opts.keepDirSelector &&
    css.includes(':dir(') &&
    !code.includes(':dir(')
  ) {
    opts.onLoweredDir();
  }
  return code;
}

/** The Lightning CSS features that keep `:dir()` as written and every other
 *  selector as the targets compile it, over a config's own (Vite's
 *  `css.lightningcss`). */
export function keptDirFeatures(
  own: { include?: number; exclude?: number } = {}
) {
  const exclude = (own.exclude ?? 0) | Features.DirSelector;
  // Any excluded selector feature turns off all selector compilation unless
  // one is included (should_compile_selectors, targets.rs, lightningcss
  // v1.33.0). IsSelector compiles nothing the targets do not need; a config
  // that already excludes a selector feature has turned it off itself.
  if ((own.exclude ?? 0) & Features.Selectors) return { exclude };
  return { include: (own.include ?? 0) | Features.IsSelector, exclude };
}

/** A `:dir()` that `by` lowered for the targets `option` names differs from
 *  the one authored; the remedies are the keep option, or raising those
 *  targets. */
export function loweredDirDiagnostic(
  by: string,
  option: string
): ManifestDiagnostic {
  return {
    file: 'stylesheet',
    component: ':dir()',
    kind: 'warn',
    message:
      `${by} lowers :dir() to :lang() over right-to-left language codes for ` +
      `${option}, so an element that sets only dir="rtl" or dir="ltr" does ` +
      'not match those rules. Set keepDirSelector: true to keep :dir() as ' +
      `written, or raise ${option} to browsers that support it (Chrome 120, ` +
      'Firefox 49, Safari 16.4).',
    code: LOWERED_DIR_SELECTOR,
    severity: severityFor(LOWERED_DIR_SELECTOR),
  };
}
