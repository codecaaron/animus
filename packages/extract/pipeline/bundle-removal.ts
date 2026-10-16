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

/**
 * Which of `classNames` the build's output names, itself or through a name
 * derived from it (`{class}--size-sm`): each output text is searched for
 * the classes' prefixes (`animus-`, a `shortClassNames` prefix), and each
 * whole token found there read once.
 */
export function shippedClasses(
  texts: Iterable<string>,
  classNames: Iterable<string>
): Set<string> {
  const candidates = new Set(classNames);
  const prefixes = new Set(
    [...candidates].map((name) => name.slice(0, name.indexOf('-') + 1))
  );
  const shipped = new Set<string>();
  const token = /[\w-]*/y;
  for (const text of texts) {
    for (const prefix of prefixes) {
      for (
        let at = text.indexOf(prefix);
        at !== -1 && shipped.size < candidates.size;
        at = text.indexOf(prefix, at + prefix.length)
      ) {
        if (at > 0 && /[\w-]/.test(text[at - 1]!)) continue;
        token.lastIndex = at;
        const name = classStem(token.exec(text)![0]);
        if (candidates.has(name)) shipped.add(name);
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
