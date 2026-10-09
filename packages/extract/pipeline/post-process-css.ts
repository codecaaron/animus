import browserslist from 'browserslist';
import {
  browserslistToTargets,
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
    warnFn?: (msg: string) => void;
  }
): string {
  if (!css) return css;
  try {
    const result = lcssTransform({
      filename: 'animus-extracted.css',
      code: Buffer.from(css),
      minify: opts.minify,
      targets: opts.targets,
    });
    return result.code.toString();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
}
