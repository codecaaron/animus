import browserslist from 'browserslist';
import {
  browserslistToTargets,
  Features,
  transform as lcssTransform,
} from 'lightningcss';

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
  try {
    const result = lcssTransform({
      filename: 'animus-extracted.css',
      code: Buffer.from(css),
      minify: opts.minify,
      targets: opts.targets,
      ...(opts.keepDirSelector && { exclude: DIR_SELECTOR_FEATURE }),
    });
    const code = result.code.toString();
    // Lightning CSS lowers every `:dir()` for a target or none.
    if (
      opts.onLoweredDir &&
      !opts.keepDirSelector &&
      css.includes(':dir(') &&
      !code.includes(':dir(')
    ) {
      opts.onLoweredDir();
    }
    return code;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
}

/** The Lightning CSS feature flag that keeps `:dir()` as written. */
export const DIR_SELECTOR_FEATURE = Features.DirSelector;

/** Why a `:dir()` that `by` lowered for the targets `option` names differs
 *  from the one authored, and the remedies: the keep option, or raising
 *  those targets. */
export function loweredDirMessage(by: string, option: string): string {
  return (
    `${by} lowers :dir() to :lang() over right-to-left language codes for ` +
    `${option}, so an element that sets only dir="rtl" or dir="ltr" does ` +
    'not match those rules. Set keepDirSelector: true to keep :dir() as ' +
    `written, or raise ${option} to browsers that support it (Chrome 120, ` +
    'Firefox 49, Safari 16.4).'
  );
}
