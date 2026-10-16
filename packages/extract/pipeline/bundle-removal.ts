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

/** Output files whose bytes no script reads as text: images, fonts, audio
 *  and video, by extension. */
const MEDIA_FILE =
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|oga|webm|flac|mov)$/i;

/** A data URL's media type that is no text: an image other than SVG, a
 *  font, audio or video. */
const MEDIA_TYPE =
  /^(?:image\/(?!svg\+xml)|font\/|audio\/|video\/|application\/(?:font-|x-font-))/i;

/** A data URL as a script, page or style sheet writes it: its media type,
 *  whether base64, and its payload up to a quote, a parenthesis or space. */
const DATA_URL =
  /data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[\w.+-]+)*)(;base64)?,([^\s"'`()<>\\]*)/gi;

/** One output file: a script's code, or any other file's bytes. */
export interface OutputFile {
  fileName: string;
  code?: string;
  bytes?: Uint8Array;
}

/** What a build's output can read class names from. */
export interface OutputEvidence {
  /** Each readable output text and decoded data URL payload. */
  texts: string[];
  /** The first file or data URL whose bytes are no UTF-8 text, which the
   *  scan cannot read; `null` when every one is read. */
  unreadable: string | null;
}

/**
 * Everything the build's output can read class names from, as text: each
 * output file but `skipped` (Animus's own style sheets) and media files,
 * and the decoded payload of every data URL in them, nested too. Bytes no
 * UTF-8 text spells are `unreadable`, and removal then keeps everything.
 */
export function outputEvidence(
  files: Iterable<OutputFile>,
  skipped: ReadonlySet<string>
): OutputEvidence {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const texts: string[] = [];
  const pending: Array<{ origin: string; text: string }> = [];
  for (const { fileName, code, bytes } of files) {
    if (skipped.has(fileName) || MEDIA_FILE.test(fileName)) continue;
    try {
      pending.push({ origin: fileName, text: code ?? decoder.decode(bytes) });
    } catch {
      return { texts, unreadable: fileName };
    }
  }
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    texts.push(next.text);
    for (const [, type, , base64, payload] of next.text.matchAll(DATA_URL)) {
      if (type !== undefined && MEDIA_TYPE.test(type)) continue;
      const origin = `a data URL in ${next.origin}`;
      try {
        const text = base64
          ? decoder.decode(Buffer.from(payload!, 'base64'))
          : decodeURIComponent(payload!);
        pending.push({ origin, text });
      } catch {
        return { texts, unreadable: origin };
      }
    }
  }
  return { texts, unreadable: null };
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
