import { transform as lcssTransform } from 'lightningcss';

import { keptDirFeatures } from './post-process-css';

import type { ManifestComponentDescriptor } from './manifest-schema';
import type { LightningTargets } from './post-process-css';
import type { Rule, Selector } from 'lightningcss';

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
 *  whether base64, and its literal payload, up to a quote, a parenthesis,
 *  space or a template substitution (`${…}`), whose text is evidence where
 *  it is written. */
const DATA_URL =
  /data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[\w.+-]+)*)(;base64)?,([^\s"'`()<>\\$]*)/gi;

/** One output file: a text's code, or another file's bytes. */
export type OutputFile =
  | { fileName: string; code: string }
  | { fileName: string; bytes: Uint8Array };

/** One text the output can read class names from: a file's, or a data
 *  URL's payload, under the output file it is written in. */
export interface EvidenceText {
  fileName: string;
  text: string;
}

/** What a build's output can read class names from. */
export interface OutputEvidence {
  /** Each readable output text and decoded data URL payload. */
  texts: EvidenceText[];
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
  const texts: EvidenceText[] = [];
  const pending: Array<EvidenceText & { origin: string }> = [];
  for (const file of files) {
    const { fileName } = file;
    if (skipped.has(fileName) || MEDIA_FILE.test(fileName)) continue;
    try {
      const text = 'code' in file ? file.code : decoder.decode(file.bytes);
      pending.push({ fileName, origin: fileName, text });
    } catch {
      return { texts, unreadable: fileName };
    }
  }
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    texts.push({ fileName: next.fileName, text: next.text });
    if (!/data:/i.test(next.text)) continue;
    for (const [, type, , base64, payload] of next.text.matchAll(DATA_URL)) {
      if (type !== undefined && MEDIA_TYPE.test(type)) continue;
      const origin = `a data URL in ${next.origin}`;
      try {
        // Base64 stops at the first character outside its alphabet.
        const text = base64
          ? decoder.decode(
              Buffer.from(/^[A-Za-z0-9+/=_-]*/.exec(payload!)![0], 'base64')
            )
          : decodeURIComponent(payload!);
        pending.push({ fileName: next.fileName, origin, text });
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
 * counts as named, as does a name without a `-`. Every occurrence of a name
 * starts with its prefix, its text through the first `-` (`animus-`, a
 * `shortClassNames` prefix), so only the text there is read.
 */
export function shippedClasses(
  texts: Iterable<string>,
  classNames: Iterable<string>
): Set<string> {
  const shipped = new Set<string>();
  const lengths = new Map<string, number[]>();
  const candidates = new Set<string>();
  for (const name of classNames) {
    const prefix = name.slice(0, name.indexOf('-') + 1);
    if (!PROVABLE_NAME.test(name) || prefix === '') {
      shipped.add(name);
      continue;
    }
    candidates.add(name);
    const known = lengths.get(prefix) ?? [];
    if (!known.includes(name.length)) known.push(name.length);
    lengths.set(prefix, known);
  }
  const provable = /[A-Za-z0-9_-]*/y;
  let found = 0;
  for (const text of texts) {
    for (const [prefix, sizes] of lengths) {
      for (
        let at = text.indexOf(prefix);
        at !== -1 && found < candidates.size;
        at = text.indexOf(prefix, at + 1)
      ) {
        // A name occurring here spells only provable characters, so it
        // lies within the run of them that starts here.
        provable.lastIndex = at;
        const run = provable.exec(text)![0].length;
        for (const size of sizes) {
          if (size > run) continue;
          const name = text.slice(at, at + size);
          if (candidates.has(name) && !shipped.has(name)) {
            shipped.add(name);
            found += 1;
          }
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

/** Why a removed component's rule stayed. */
export type KeptRuleReason = 'shared-list' | 'nested' | 'conditional';

/** Which reason a class keeps when several rules stay for different ones. */
const KEPT_RANK = {
  conditional: 0,
  nested: 1,
  'shared-list': 2,
} satisfies Record<KeptRuleReason, number>;

/** Notes in `kept` that a rule naming `name` stayed for `reason`, unless a
 *  higher-ranked reason is already noted. */
export function noteKept(
  kept: Map<string, KeptRuleReason>,
  name: string,
  reason: KeptRuleReason
): void {
  const noted = kept.get(name);
  if (noted === undefined || KEPT_RANK[reason] > KEPT_RANK[noted]) {
    kept.set(name, reason);
  }
}

/** What removing components' rules did to one style sheet. */
export interface RuleRemoval {
  /** The sheet without the removed rules; `null` when no rule goes. */
  css: string | null;
  /** Each removed class at least one of whose rules went. */
  went: Set<string>;
  /** Each removed class a kept rule names, and why that rule stayed:
   *  another selector in its list needs no removed class
   *  (`'shared-list'`), the rule holds nested rules removal cannot prove
   *  unused (`'nested'`), or the class sits only where a selector can match
   *  without it, or in a pseudo's argument removal does not read, such as
   *  `:host()` (`'conditional'`). */
  kept: Map<string, KeptRuleReason>;
}

/**
 * The classes of `classes` that `selector` needs an element to carry: each
 * one it names outside a pseudo-class's argument, or a class derived from
 * one (`{class}--…`), and those an `:is()` or `:where()` needs where every
 * alternative in it needs one, since such a list matches only what one of
 * its alternatives matches. A nested rule's `&` needs what its parent
 * rule's selectors all need (`parent`), since the element it stands for
 * matches the parent; `null` where they need none or are unknown. Empty
 * when the selector may match without any. `:not()` and `:has()` never
 * need one.
 */
function neededClasses(
  selector: Selector,
  classes: ReadonlySet<string>,
  parent: readonly string[] | null
): string[] {
  const needed: string[] = [];
  for (const part of selector) {
    if (part.type === 'class') {
      const stem = classStem(part.name);
      if (classes.has(stem)) needed.push(stem);
    } else if (part.type === 'nesting' && parent !== null) {
      needed.push(...parent);
    } else if (
      part.type === 'pseudo-class' &&
      (part.kind === 'is' || part.kind === 'where')
    ) {
      const alternatives = part.selectors.map((alternative) =>
        neededClasses(alternative, classes, parent)
      );
      if (alternatives.every((alternative) => alternative.length > 0)) {
        needed.push(...alternatives.flat());
      }
    }
  }
  return needed;
}

/** Calls `visit` with every class name `selector` holds, inside any
 *  pseudo-class's or pseudo-element's argument too. */
function eachClass(selector: Selector, visit: (name: string) => void): void {
  for (const part of selector) {
    if (part.type === 'class') visit(part.name);
    else if (
      part.type === 'pseudo-class' &&
      (part.kind === 'not' ||
        part.kind === 'is' ||
        part.kind === 'where' ||
        part.kind === 'any' ||
        part.kind === 'has')
    ) {
      for (const inner of part.selectors) eachClass(inner, visit);
    } else if (part.type === 'pseudo-class' && part.kind === 'host') {
      if (part.selectors) eachClass(part.selectors, visit);
    } else if ('selector' in part) eachClass(part.selector, visit);
    else if ('of' in part && part.of) {
      for (const inner of part.of) eachClass(inner, visit);
    }
  }
}

/**
 * `css` without each rule all of whose selectors need an element carrying
 * one of `classes` (or a class derived from one, `{class}--…`), and without
 * each `@media`, `@supports` or `@container` rule that removal empties. A
 * rule with another selector stays whole, since Lightning CSS cannot hand
 * back every rule it reads. Throws when the sheet does not parse.
 */
export function removeComponentRules(
  css: string,
  classes: ReadonlySet<string>,
  opts: { targets: LightningTargets; keepDirSelector?: boolean }
): RuleRemoval {
  const went = new Set<string>();
  const kept = new Map<string, KeptRuleReason>();
  if (![...classes].some((name) => css.includes(name))) {
    return { css: null, went, kept };
  }
  const needsOf = (
    selectors: Selector[],
    parent: readonly string[] | null = null
  ) => selectors.map((selector) => neededClasses(selector, classes, parent));
  const everyNeeds = (needs: string[][]) =>
    needs.every((needed) => needed.length > 0);
  // Whether `rule` goes: a style rule every selector of which needs a
  // removed class and every rule nested in which goes too, or a `@media`,
  // `@supports` or `@container` rule removal empties, which applies nothing.
  // `parent` is what the enclosing style rule's selectors all need, when
  // `rule` is nested in one that may go. A nested rule's `&` may match
  // outside its parent (`:not(&)`), so it goes only where its selector
  // needs a removed class, `&` counting outside a pseudo-class only; the
  // declarations nested in a style rule are that rule's. An emptied
  // `@layer` block stays, since it still places its layer in the layer
  // order, nested in a style rule too; a second minifying pass would drop
  // the emptied at-rules, but would also rewrite such a block and what else
  // it finds.
  const goes = (
    rule: Rule,
    parent: readonly string[] | null = null
  ): boolean => {
    switch (rule.type) {
      case 'style': {
        const needs = needsOf(rule.value.selectors, parent);
        const own = needs.flat();
        return (
          everyNeeds(needs) &&
          (rule.value.rules ?? []).every((inner) => goes(inner, own))
        );
      }
      case 'nested-declarations':
        return parent !== null;
      case 'media':
      case 'supports':
      case 'container':
        return (
          rule.value.rules.length > 0 &&
          rule.value.rules.every((inner) => goes(inner, parent))
        );
      default:
        return false;
    }
  };
  // Notes the classes each style rule in a rule that goes needs, nested
  // style rules too, since Lightning CSS visits nothing inside a rule a
  // visitor drops.
  const record = (
    rule: Rule,
    parent: readonly string[] | null = null
  ): void => {
    if (rule.type === 'style') {
      const own = needsOf(rule.value.selectors, parent).flat();
      for (const name of own) went.add(name);
      for (const inner of rule.value.rules ?? []) record(inner, own);
    } else if (
      rule.type === 'media' ||
      rule.type === 'supports' ||
      rule.type === 'container'
    ) {
      for (const inner of rule.value.rules) record(inner, parent);
    }
  };
  const drop = (rule: Rule) => {
    if (!goes(rule)) return;
    record(rule);
    return [];
  };
  const code = lcssTransform({
    filename: 'animus-bundle-removal.css',
    code: Buffer.from(css),
    minify: true,
    targets: opts.targets,
    ...(opts.keepDirSelector && keptDirFeatures()),
    visitor: {
      Rule: {
        style(rule) {
          const dropped = drop(rule);
          if (dropped) return dropped;
          const needs = needsOf(rule.value.selectors);
          const needed = new Set(needs.flat());
          const nested = everyNeeds(needs);
          for (const selector of rule.value.selectors) {
            eachClass(selector, (name) => {
              const stem = classStem(name);
              if (!classes.has(stem)) return;
              noteKept(
                kept,
                stem,
                !needed.has(stem)
                  ? 'conditional'
                  : nested
                    ? 'nested'
                    : 'shared-list'
              );
            });
          }
        },
        media: drop,
        supports: drop,
        container: drop,
      },
    },
  }).code.toString();
  // A rule goes only where a style rule goes, which notes its classes.
  return { css: went.size > 0 ? code : null, went, kept };
}
