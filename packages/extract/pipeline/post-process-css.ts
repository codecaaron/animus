import browserslist from 'browserslist';
import {
  browserslistToTargets,
  Features,
  transform as lcssTransform,
} from 'lightningcss';

import {
  hostFinding,
  LOWERED_DIR_SELECTOR,
  POST_PROCESSING_FAILED,
  severityFor,
  surfaceManifestDiagnostics,
} from './manifest-diagnostics';

import type { ManifestDiagnostic } from './manifest-diagnostics';

export type LightningTargets = ReturnType<typeof browserslistToTargets>;

/** The features a host's own Lightning CSS pass includes and excludes
 *  (Vite's `css.lightningcss`), which Animus's pass follows. */
export type LightningFeatures = { include?: number; exclude?: number };

/** The targets and features a host's own Lightning CSS pass uses, which
 *  Animus's pass follows. */
export type HostLightning = {
  targets: LightningTargets;
  features: LightningFeatures;
};

/** Targets with what named them, for the host's log. */
type SourcedLightningTargets = {
  targets: LightningTargets;
  source: string;
};

export function resolveLightningTargets(
  explicitTargets: string | string[] | undefined,
  rootDir: string
): LightningTargets {
  return lightningTargetsFor(explicitTargets, rootDir).targets;
}

/** The targets and what named them: the `targets` option, then the root's
 *  browserslist config, then the host's own CSS targets where it has them,
 *  then browserslist `defaults`. */
export function lightningTargetsFor(
  explicitTargets: string | string[] | undefined,
  rootDir: string,
  host?: SourcedLightningTargets
): SourcedLightningTargets {
  // Explicit targets always resolve: a one-word query such as 'defaults' is
  // no browser id, and a resolved id ('chrome 120') resolves to itself.
  if (explicitTargets) {
    return {
      targets: browserslistToTargets(browserslist(explicitTargets)),
      source: 'the targets option',
    };
  }
  const configured = browserslist.loadConfig({ path: rootDir }) !== undefined;
  if (host && !configured) return host;
  const detected = browserslist(undefined, { path: rootDir });
  return {
    targets: browserslistToTargets(
      detected.length > 0 ? detected : browserslist('defaults')
    ),
    source: configured ? 'the browserslist config' : 'browserslist defaults',
  };
}

/** Each browser's minimum version in `targets`, as `chrome 111, safari
 *  16.4`: Lightning CSS packs a version as major << 16 | minor << 8 | patch,
 *  and a zero minor or patch is left out. */
export function describeLightningTargets(targets: LightningTargets): string {
  return Object.entries(targets)
    .flatMap(([browser, packed]) => {
      if (packed === undefined) return [];
      const parts = [packed >>> 16, (packed >> 8) & 0xff, packed & 0xff];
      while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
      return [`${browser} ${parts.join('.')}`];
    })
    .join(', ');
}

type TransformOptions = {
  minify: boolean;
  targets: LightningTargets;
  /** Keeps `:dir()` as written where the targets would lower it. */
  keepDirSelector?: boolean;
  features?: LightningFeatures;
};

/** The latest transforms, newest first. A build post-processes one sheet
 *  for the session and again where the host serves it, and an edit that
 *  leaves the CSS as it was repeats the session's. */
const kept: { options: string; css: string; code: string }[] = [];
const TRANSFORMS_KEPT = 2;

/** Every enumerable browser the targets name, inherited ones included, as
 *  Lightning CSS reads them: the key and the transform see the same map. */
function enumerableTargets(targets: LightningTargets): LightningTargets {
  const own: LightningTargets = {};
  for (const browser in targets) {
    // SAFETY: for-in yields the targets' own and inherited enumerable keys,
    // each a browser name Lightning CSS reads.
    const name = browser as keyof LightningTargets;
    own[name] = targets[name];
  }
  return own;
}

function transformOnce(css: string, opts: TransformOptions): string {
  const keepDirSelector = opts.keepDirSelector ?? false;
  const targets = enumerableTargets(opts.targets);
  const features = keepDirSelector
    ? keptDirFeatures(opts.features)
    : {
        include: opts.features?.include ?? 0,
        exclude: opts.features?.exclude ?? 0,
      };
  const options = JSON.stringify([opts.minify, targets, features]);
  const hit = kept.find(
    (entry) => entry.options === options && entry.css === css
  );
  if (hit) return hit.code;
  const code = lcssTransform({
    filename: 'animus-extracted.css',
    code: Buffer.from(css),
    minify: opts.minify,
    targets,
    ...features,
  }).code.toString();
  kept.unshift({ options, css, code });
  kept.length = Math.min(kept.length, TRANSFORMS_KEPT);
  return code;
}

export function postProcessCss(
  css: string,
  opts: TransformOptions & {
    /** Receives the finding when Lightning CSS fails and the stylesheet
     *  ships unprocessed; without it, the finding prints as a warning. */
    reportFailure?: (diagnostic: ManifestDiagnostic) => void;
    /** Called when the targets lowered an authored `:dir()`. */
    onLoweredDir?: () => void;
  }
): string {
  if (!css) return css;
  let code: string;
  try {
    code = transformOnce(css, opts);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const failure = hostFinding(
      POST_PROCESSING_FAILED,
      'stylesheet',
      'post-processing',
      `Lightning CSS post-processing failed, so it ships unprocessed: ${msg}`
    );
    const report =
      opts.reportFailure ??
      ((d) =>
        surfaceManifestDiagnostics({ diagnostics: [d] }, (line) =>
          // eslint-disable-next-line no-console
          console.warn(`[animus] ${line}`)
        ));
    report(failure);
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
export function keptDirFeatures(own: LightningFeatures = {}) {
  const exclude = (own.exclude ?? 0) | Features.DirSelector;
  // An included feature compiles whatever the exclusions say, so a config's
  // include (`Features.Selectors`, say) keeps every bit but DirSelector.
  const include = (own.include ?? 0) & ~Features.DirSelector;
  // Any excluded selector feature turns off all selector compilation unless
  // one is included (should_compile_selectors, targets.rs, lightningcss
  // v1.33.0). IsSelector compiles nothing the targets do not need; a config
  // that already excludes a selector feature has turned it off itself, and
  // one merged here already includes IsSelector, so a second merge is equal.
  if ((own.exclude ?? 0) & Features.Selectors) return { include, exclude };
  return { include: include | Features.IsSelector, exclude };
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
