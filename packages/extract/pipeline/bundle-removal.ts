import { transform as lcssTransform } from 'lightningcss';

import { keptDirFeatures } from './post-process-css';

import type { ManifestComponentDescriptor } from './manifest-schema';
import type { LightningTargets } from './post-process-css';

/** A class's component class: the name before a derived suffix
 *  (`{class}--size-sm`), or the name itself. */
function classStem(name: string): string {
  const stem = name.indexOf('--');
  return stem > 0 ? name.slice(0, stem) : name;
}

/** A class name a scan can prove absent: one only ASCII letters, digits,
 *  `_` and `-` spell, which no output escapes. */
const PROVABLE_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Which of `classNames` the build's output may name: each one whose exact
 * spelling occurs anywhere in an output text, and each one the scan cannot
 * prove absent. A name with any other character (`Café`, `$Box`) may be
 * spelled escaped (`\u00e9`, `\$`, `&#233;`, `%C3%A9`), so it always
 * counts as named. Every occurrence of a name starts with its prefix
 * (`animus-`, a `shortClassNames` prefix), so only the text there is read.
 */
export function shippedClasses(
  texts: Iterable<string>,
  classNames: Iterable<string>
): Set<string> {
  const shipped = new Set<string>();
  const lengths = new Map<string, Set<number>>();
  const candidates = new Set<string>();
  for (const name of classNames) {
    if (!PROVABLE_NAME.test(name)) {
      shipped.add(name);
      continue;
    }
    candidates.add(name);
    const prefix = name.slice(0, name.indexOf('-') + 1);
    let known = lengths.get(prefix);
    if (known === undefined) lengths.set(prefix, (known = new Set()));
    known.add(name.length);
  }
  for (const text of texts) {
    for (const [prefix, sizes] of lengths) {
      for (
        let at = text.indexOf(prefix);
        at !== -1;
        at = text.indexOf(prefix, at + 1)
      ) {
        for (const size of sizes) {
          const name = text.slice(at, at + size);
          if (candidates.has(name)) shipped.add(name);
        }
      }
    }
  }
  return shipped;
}

/**
 * The components whose definition no output file holds, which can never
 * render: a component's transformed definition names its class as a string
 * literal, so a build that drops the definition drops every use of the
 * class. Kept are a component the output names (`shipped`), one
 * `staticCss` declares, every parent of a kept extension, and every
 * component sharing a kept one's class. Returns each removed component's id
 * and class.
 */
export function unbundledComponents(
  components: Record<string, ManifestComponentDescriptor>,
  shipped: ReadonlySet<string>,
  staticCssBindings: ReadonlySet<string>
): Map<string, string> {
  const kept = new Set<string>();
  for (const [id, component] of Object.entries(components)) {
    if (
      !shipped.has(component.class_name) &&
      !staticCssBindings.has(component.binding)
    ) {
      continue;
    }
    for (let at: string | null = id; at !== null && !kept.has(at);) {
      kept.add(at);
      at = components[at]?.extends_from ?? null;
    }
  }
  // CSS belongs to a class, which copies of one definition share: a class
  // any kept component carries stays, whatever other id carries it too.
  const keptClasses = new Set(
    [...kept].map((id) => components[id]!.class_name)
  );
  const removed = new Map<string, string>();
  for (const [id, component] of Object.entries(components)) {
    if (!keptClasses.has(component.class_name)) {
      removed.set(id, component.class_name);
    }
  }
  return removed;
}

/**
 * `css` without each rule all of whose selectors need an element carrying
 * one of `classes` (or a class derived from one, `{class}--…`); `null` when
 * no rule goes. Only a class the selector itself requires counts: one inside
 * `:not()`, `:is()`, `:where()` or `:has()` may match without it. A rule
 * with another selector stays whole, since Lightning CSS cannot hand back
 * every rule it reads. Throws when the sheet does not parse.
 */
export function removeComponentRules(
  css: string,
  classes: ReadonlySet<string>,
  opts: { targets: LightningTargets; keepDirSelector?: boolean }
): string | null {
  if (![...classes].some((name) => css.includes(name))) return null;
  let removed = false;
  const code = lcssTransform({
    filename: 'animus-bundle-removal.css',
    code: Buffer.from(css),
    minify: true,
    targets: opts.targets,
    ...(opts.keepDirSelector && keptDirFeatures()),
    visitor: {
      Rule: {
        style(rule) {
          const needed = rule.value.selectors.every((selector) =>
            selector.some(
              (part) =>
                part.type === 'class' && classes.has(classStem(part.name))
            )
          );
          if (!needed) return;
          removed = true;
          return [];
        },
      },
    },
  }).code.toString();
  return removed ? code : null;
}
