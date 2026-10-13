/** What layergate owns and how it layers it, as configured. */
export interface LayergateOptions {
  /** The cascade layer each owned stylesheet's own rules go into. Default
   *  `vendor`. */
  layer?: string;
  /** The full layer order every finished stylesheet declares first; it must
   *  include `layer`. Default: `[layer]`. */
  order?: readonly string[];
  /** Stylesheets `virtual:layergate` delivers, in this order, whether or
   *  not anything else imports them: package specifiers or paths relative
   *  to the Vite root. */
  sheets?: readonly string[];
  /** Also own `.css` a JS module imports from a package other than the app:
   *  `true` for every package, or the package names. Default: none. */
  dependencies?: boolean | readonly string[];
  /** Files inside an owned graph whose own rules stay outside the layer:
   *  exact package specifiers or paths, never globs. */
  optOut?: readonly string[];
}

export interface LayergatePlan {
  layer: string;
  order: readonly string[];
  sheets: readonly string[];
  dependencies: boolean | ReadonlySet<string>;
  optOut: readonly string[];
}

/** A layer name: identifiers joined by dots. */
const LAYER_NAME = /^-?[_a-zA-Z][\w-]*(?:\.-?[_a-zA-Z][\w-]*)*$/;

export class LayergateConfigError extends Error {
  override name = 'LayergateConfigError';
}

/** The plan `options` describe, or a `LayergateConfigError`. */
export function resolvePlan(options: LayergateOptions = {}): LayergatePlan {
  const layer = options.layer ?? 'vendor';
  if (!LAYER_NAME.test(layer)) {
    throw new LayergateConfigError(`layer "${layer}" is not a layer name`);
  }
  const order = options.order ?? [layer];
  for (const name of order) {
    if (!LAYER_NAME.test(name)) throw new LayergateConfigError(`order: "${name}" is not a layer name`);
  }
  const duplicate = order.find((name, index) => order.indexOf(name) !== index);
  if (duplicate) throw new LayergateConfigError(`order: "${duplicate}" appears twice`);
  if (!order.includes(layer)) {
    throw new LayergateConfigError(`order must include the quarantine layer "${layer}"`);
  }
  const optOut = options.optOut ?? [];
  const glob = optOut.find((entry) => /[*?[\]{}]/.test(entry));
  if (glob) throw new LayergateConfigError(`optOut: "${glob}" is a pattern; list exact files`);
  const dependencies = options.dependencies ?? false;
  return {
    layer,
    order,
    sheets: options.sheets ?? [],
    dependencies: dependencies === true || dependencies === false ? dependencies : new Set(dependencies),
    optOut,
  };
}
