import { Animus } from './Animus';
import { type AssetRef } from './asset.js';
import {
  type AtRuleValue,
  BUILT_IN_CONDITIONS,
  type ConditionAliasMap,
  mergeConditions,
  type NarrowedAliases,
  type RegistryBrand,
  type ReservedByConditionRegistry,
  type ReservedBySelectorRegistry,
  serializeConditionMap,
} from './conditions';
import { isDeclarationProp, validateDeclarationProp } from './declarations';
import {
  type KeyframeFrameMap,
  type Keyframes,
  keyframes as keyframesImpl,
} from './keyframes';
import {
  type PositionTries,
  type PositionTryDescriptors,
  positionTries as positionTriesImpl,
} from './positionTry';
import {
  BUILT_IN_SELECTORS,
  mergeSelectors,
  type SelectorAliasMap,
  serializeSelectorMap,
} from './selectors';
import {
  areTransformsEqual,
  linkAuthoredCallable,
  NamedTransform,
  TransformFn,
} from './transforms/createTransform';
import {
  type BuiltInConditionAlias,
  type BuiltInSelectorAlias,
  Prop,
  SystemProp,
  ThemedCSSInputProps,
} from './types/config';
import { AbstractProps } from './types/props';
import {
  type ViewTransitions,
  type ViewTransitionSlot,
  type ViewTransitionSlots,
  viewTransitions as viewTransitionsImpl,
} from './viewTransition';

type SerializedPropEntry =
  | SerializedValuePropEntry
  | SerializedDeclarationPropEntry;

interface SerializedDeclarationPropEntry {
  kind: 'declarations';
  scale: string;
  members: string[];
}

interface SerializedValuePropEntry {
  property: string;
  properties?: string[];
  scale?: string | Record<string, string | number> | (string | number)[];
  /** The transform's readable name, for diagnostics only. */
  transform?: string;
  /** The definition this prop is bound to; see `transformDefinitionId`. */
  transformId?: string;
  currentVar?: string;
  negative?: boolean;
  /** Present only when values are limited to the scale; an older reader
   *  ignores it and keeps raw values. */
  strict?: true;
}

export type GlobalStyleMap = Record<string, Record<string, any>>;

/** A font the browser loads: rendered as `url('…') format('…') tech(…)`. */
export interface FontFaceUrlSrc {
  /**
   * A literal string is emitted as written, escaped inside its quotes; an
   * `AssetRef` emits its placeholder string, which the host plugin
   * substitutes after extraction.
   */
  url: string | AssetRef;
  /** Format hint (`woff2`, `woff`, …), rendered as `format('…')`. */
  format?: string;
  /** Technology hint (`variations`, `color-COLRv1`, …), rendered as `tech(…)`. */
  tech?: string;
  local?: never;
}

/** A font installed on the device, by its full name: rendered as `local(…)`. */
export interface FontFaceLocalSrc {
  local: string;
  url?: never;
  format?: never;
  tech?: never;
}

export type FontFaceSrc = FontFaceUrlSrc | FontFaceLocalSrc;

/**
 * `family` names one font: a name (`'Mona Sans'`) or a font-scale token
 * reference (`{fonts.brand}`) that resolves to one name. A token that
 * resolves to a stack (`Inter, sans-serif`) or to a `var()` reports
 * `animus.style.font-face-dropped`, and the face is not emitted. The other
 * descriptors take CSS literals only, written as strings.
 */
export interface FontFace {
  family: string;
  src: FontFaceSrc[];
  weight?: string;
  style?: string;
  display?: string;
  unicodeRange?: string;
  stretch?: string;
  sizeAdjust?: string;
  ascentOverride?: string;
  descentOverride?: string;
  lineGapOverride?: string;
  fontFeatureSettings?: string;
  fontVariationSettings?: string;
  /**
   * Ask the document to start loading the face's file before its
   * stylesheet applies: the file the browser's `@font-face` loads, its
   * first `url` source in a format browsers load (an EOT or SVG font is
   * skipped). Order `src` as the browser should prefer it, WOFF2 first.
   * That source must be an `asset()` file or a root-relative or absolute
   * URL. The host delivers the `<link rel="preload">`: Vite injects it
   * into `index.html`; Next renders it through `AnimusFontPreloads`;
   * Rollup, webpack and the CLI emit a manifest for `renderFontPreloads`.
   * A host's `fontPreloads` option (family names, or `{ family, weight?,
   * style?, unicodeRange?, fetchpriority? }`) decides instead of this flag,
   * for an app that renders only some of a system's faces.
   *
   * A preload competes with the critical CSS and JavaScript for the
   * connection: it trades first paint for no font swap. In consumer apps a
   * WOFF2 face delayed first paint by about 40–140 ms (one 219 KB variable
   * WOFF2: about 140 ms on a fast link, 1.1 s on a slow one), while an
   * 877 KB TrueType face removed the swap but delayed first paint by about
   * 5 s on slow 4G. Preload WOFF2, subset a large font, and preload only the
   * faces the first screen needs. A preloaded file that is not WOFF2 or
   * WOFF, or an `asset()` file over 150 KB, reports
   * `animus.style.font-face-preload-costly`.
   *
   * `preload` is a source-level flag: the system module ships to the
   * browser, so changing it changes that module's chunk hash, and the hashes
   * of the chunks that import it.
   */
  preload?: boolean;
}

export interface GlobalStyleBlock {
  __brand: 'GlobalStyleBlock';
  styles: GlobalStyleMap;
  /** Rendered ahead of the block's selector rules. */
  fontFaces?: FontFace[];
  /**
   * Emitted outside every cascade layer, after `@layer anm-global`, so its
   * rules can win over unlayered vendor CSS; otherwise in `anm-global`.
   */
  unlayered?: true;
}

export type GlobalStylesFactory<
  PropReg extends Record<string, SystemProp> = Record<string, SystemProp>,
> = {
  /** A block of font faces alone: `createGlobalStyles({}, { fontFaces })`. */
  (fontFaces: readonly FontFace[]): GlobalStyleBlock;
  <Map extends Record<string, AbstractProps>>(
    styles: {
      readonly [K in keyof Map]: ThemedCSSInputProps<Map[K], PropReg>;
    },
    options?: { fontFaces?: readonly FontFace[]; unlayered?: boolean }
  ): GlobalStyleBlock;
};

export type CreateKeyframesFactory<
  PropReg extends Record<string, SystemProp> = Record<string, SystemProp>,
> = <Frames extends Record<string, Record<string, AbstractProps>>>(frames: {
  readonly [N in keyof Frames]: {
    readonly [S in keyof Frames[N]]: ThemedCSSInputProps<Frames[N][S], PropReg>;
  };
}) => Keyframes<{
  readonly [N in keyof Frames]: KeyframeFrameMap;
}>;

/** Fallback positions for anchor positioning, each an `@position-try` rule
 *  named from its descriptors. */
export type CreatePositionTryFactory = <
  Map extends Record<string, PositionTryDescriptors>,
>(
  tries: Map
) => PositionTries<Map>;

/** View transitions, each a class whose `group`, `imagePair`, `old` and
 *  `new` slots style its view-transition pseudo-elements. */
export type CreateViewTransitionsFactory<
  PropReg extends Record<string, SystemProp> = Record<string, SystemProp>,
> = <
  Transitions extends Record<
    string,
    Partial<Record<ViewTransitionSlot, AbstractProps>>
  >,
>(transitions: {
  readonly [N in keyof Transitions]: {
    readonly [S in keyof Transitions[N]]: ThemedCSSInputProps<
      Transitions[N][S],
      PropReg
    >;
  };
}) => ViewTransitions<{
  readonly [N in keyof Transitions]: ViewTransitionSlots;
}>;

type IncludableSystem = {
  toConfig(): SerializedConfig;
  /**
   * Optional only so systems built by an older @animus-ui/system stay
   * structurally acceptable; `extend()` throws when it is absent.
   */
  getRegistrySnapshot?(): RegistrySnapshot;
};

/**
 * Frozen at `build()`: `toConfig()` serializes and `extend()` merges from
 * it, so post-build mutation of the public registries reaches neither.
 */
export interface RegistrySnapshot {
  props: Record<string, SystemProp>;
  groups: Record<string, readonly string[]>;
  selectors: SelectorAliasMap;
  conditions: ConditionAliasMap;
}

/**
 * The shape `registerKeyframes` accepts. The brand is structural: a
 * hand-rolled object carrying it is admitted; provenance is not checked.
 */
export interface RegisterableKeyframes {
  readonly __brand: 'Keyframes';
  readonly __frames: object;
}

/** The shape `registerPositionTry` accepts; the brand is structural. */
export interface RegisterablePositionTries {
  readonly __brand: 'PositionTries';
  readonly __tries: object;
}

/** The shape `registerViewTransitions` accepts; the brand is structural. */
export interface RegisterableViewTransitions {
  readonly __brand: 'ViewTransitions';
  readonly __transitions: object;
}

export interface RegisterableGlobalStyles {
  readonly __brand: 'GlobalStyleBlock';
  readonly styles: object;
}

export type KeyframesFrameData = Record<
  string,
  { readonly name: string; readonly frames: KeyframeFrameMap }
>;

export interface VocabularyKeyframesEntry {
  readonly name: string;
  readonly frames: KeyframesFrameData;
}

export type PositionTryData = Record<
  string,
  { readonly name: string; readonly descriptors: PositionTryDescriptors }
>;

export interface VocabularyPositionTryEntry {
  readonly name: string;
  readonly tries: PositionTryData;
}

export type ViewTransitionData = Record<
  string,
  { readonly name: string; readonly slots: ViewTransitionSlots }
>;

export interface VocabularyViewTransitionEntry {
  readonly name: string;
  readonly transitions: ViewTransitionData;
}

export interface VocabularyGlobalStyleEntry {
  readonly name: string;
  readonly styles: GlobalStyleMap;
  readonly fontFaces?: readonly FontFace[];
  readonly unlayered?: true;
}

export interface VocabularyCollisionEntry {
  /** Stable machine code — the record, not the console, is the witness
   * channel (the loader's evaluation host shims `console` to a no-op). */
  readonly code: 'animus.vocabulary.collision';
  readonly name: string;
  readonly winner: string;
  readonly loser: string;
}

/**
 * Names a sealed source's registered vocabulary that `from()` / `includes:`
 * did not deliver — those verbs merge no registries; `.extend()` does.
 */
export interface VocabularyLegacyVerbEntry {
  readonly code: 'animus.vocabulary.legacy-verb';
  readonly verb: 'from' | 'includes';
  /** Positional label (`includes source #1`) — a source has no knowable
   *  export name at this seam. */
  readonly source: string;
  readonly names: readonly string[];
}

/**
 * The registration record a sealed system carries, in declaration order.
 * The loader reads registered collections exclusively from here. Version 2
 * marks a record holding a kind version 1 lacks (position tries or view
 * transitions), so a
 * loader that reads only version 1 fails loud instead of dropping it; any
 * other record stays version 1.
 */
export interface VocabularyRecord {
  readonly version: 1 | 2;
  readonly keyframes: readonly VocabularyKeyframesEntry[];
  /** Absent from a version 1 record. */
  readonly positionTries?: readonly VocabularyPositionTryEntry[];
  /** Absent from a version 1 record. */
  readonly viewTransitions?: readonly VocabularyViewTransitionEntry[];
  readonly globalStyles: readonly VocabularyGlobalStyleEntry[];
  readonly collisions: readonly VocabularyCollisionEntry[];
  readonly legacyVerbs: readonly VocabularyLegacyVerbEntry[];
}

/** ONE name-space across every kind: no two registered collections or
 *  global-style blocks share a name, whatever their kinds. */
type VocabularyEntryInput =
  | { kind: 'keyframes'; name: string; frames: KeyframesFrameData }
  | { kind: 'positionTry'; name: string; tries: PositionTryData }
  | {
      kind: 'viewTransitions';
      name: string;
      transitions: ViewTransitionData;
    }
  | {
      kind: 'globalStyles';
      name: string;
      styles: GlobalStyleMap;
      fontFaces?: readonly FontFace[];
      unlayered?: true;
    };

/** An entry as the registry holds it, with where it was declared. */
type VocabularyEntryState = VocabularyEntryInput & { origin: string };

/**
 * No console output: a warn here would ship in production consumer bundles,
 * and the extraction host shims `console`. The record is the witness.
 */
function legacyVerbWitness(
  source: IncludableSystem,
  verb: 'from' | 'includes',
  sourceIndex: number
): VocabularyLegacyVerbEntry | null {
  const record = (
    source as { getVocabularyRecord?(): VocabularyRecord }
  ).getVocabularyRecord?.();
  if (!record) return null;
  const names = [
    ...record.keyframes.map((entry) => entry.name),
    ...(record.positionTries ?? []).map((entry) => entry.name),
    ...(record.viewTransitions ?? []).map((entry) => entry.name),
    ...record.globalStyles.map((entry) => entry.name),
  ];
  if (names.length === 0) return null;
  return {
    code: 'animus.vocabulary.legacy-verb',
    verb,
    source: `${verb} source #${sourceIndex}`,
    names,
  };
}

/** `blocks`, and each block, frozen; deeper values alias. */
const freezeBlocks = <Block extends object>(
  blocks: Readonly<Record<string, Block>>
): Readonly<Record<string, Block>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(blocks).map(([key, block]) => [
        key,
        Object.freeze({ ...block }),
      ])
    )
  );

/**
 * A registered collection's entries copied by `copy` and frozen, so later
 * mutation of the caller's collection cannot reach a sealed record.
 */
const snapshotEntries = <Entry extends { readonly name: string }>(
  entries: Readonly<Record<string, Entry>>,
  copy: (entry: Entry) => Entry
): Readonly<Record<string, Entry>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [
        key,
        Object.freeze(copy(entry)),
      ])
    )
  );

/**
 * Each registered value's `field`, once the value is checked to be what
 * `factory` returns: an object branded `brand` that holds `field`. The brand
 * is structural; provenance is not checked.
 */
function registeredPayloads<Payload>(
  method: string,
  factory: string,
  brand: string,
  field: string,
  map: Readonly<Record<string, unknown>>
): [string, Payload][] {
  return Object.entries(map).map(([name, value]) => {
    const branded = value as Record<string, unknown> | null | undefined;
    if (
      !branded ||
      branded.__brand !== brand ||
      typeof branded[field] !== 'object'
    ) {
      throw new TypeError(
        `${method}: "${name}" is not a ${factory} collection — register ` +
          'the factory return value itself.'
      );
    }
    // SAFETY: the brand names the factory, whose `field` is this payload.
    return [name, branded[field] as Payload];
  });
}

/**
 * A name collision resolves to the incoming side, and the winner takes the
 * incoming declaration position so record order stays declaration order.
 */
function mergeVocabularyEntries(
  existingEntries: readonly VocabularyEntryState[],
  existingCollisions: readonly VocabularyCollisionEntry[],
  incoming: ReadonlyArray<VocabularyEntryInput>,
  incomingOrigin: string
): {
  entries: VocabularyEntryState[];
  collisions: VocabularyCollisionEntry[];
} {
  const entries = existingEntries.map((entry) => ({ ...entry }));
  const collisions = [...existingCollisions];
  for (const input of incoming) {
    const existingIndex = entries.findIndex(
      (entry) => entry.name === input.name
    );
    if (existingIndex !== -1) {
      const loser = entries[existingIndex];
      collisions.push({
        code: 'animus.vocabulary.collision',
        name: input.name,
        winner: incomingOrigin,
        loser: loser.origin,
      });
      // oxlint-disable-next-line no-console -- intentional runtime diagnostic
      console.warn(
        `animus: vocabulary "${input.name}" is registered by both ` +
          `${loser.origin} and ${incomingOrigin} — ${incomingOrigin} wins; ` +
          'rename one entry (animus.vocabulary.collision)'
      );
      entries.splice(existingIndex, 1);
    }
    entries.push({ ...input, origin: incomingOrigin });
  }
  return { entries, collisions };
}

declare const VOCABULARY_COLLISION_BRAND: unique symbol;

/**
 * Impossible-to-satisfy marker so a colliding registration site reports the
 * offending vocabulary name instead of a bare structural mismatch.
 */
export interface VocabularyNameCollision<Name extends string> {
  readonly [VOCABULARY_COLLISION_BRAND]: `Vocabulary name "${Name}" is already registered on this system`;
}

declare const VOCABULARY_INDEX_SIGNATURE: unique symbol;

/**
 * Rejects index-signature maps: they bypass the collision mapping
 * (`Extract<string, Vocab>` is `never`) and widen the axis to `string`.
 */
export interface VocabularyIndexSignatureRejected {
  readonly [VOCABULARY_INDEX_SIGNATURE]: 'vocabulary registration requires literal keys — an index-signature map cannot prove its names';
}

type LiteralKeyMap<M> = string extends keyof M
  ? VocabularyIndexSignatureRejected
  : unknown;

declare const VOCABULARY_BRAND: unique symbol;

/**
 * What `seal()` returns. The registered names ride as phantom type state so
 * `.extend()` can make a collision a compile error in a consumer's chain.
 * They ride in a one-element tuple: inferring from a bare optional `never`
 * yields `string`, which made an empty system's vocabulary every name.
 */
export type SealedSystemInstance<
  PropReg extends Record<string, SystemProp>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  Vocab extends string = never,
> = SystemInstance<PropReg, GroupReg, Conds, Sels, Vocab> & {
  getVocabularyRecord(): VocabularyRecord;
  readonly [VOCABULARY_BRAND]?: [Vocab];
};

export type VocabularyOf<S> = S extends {
  readonly [VOCABULARY_BRAND]?: [infer V];
}
  ? Extract<V, string>
  : never;

/**
 * The `build()` return. Registration is linear — chain the returned bundle;
 * one `seal()` per bundle, and later registering or re-sealing throws.
 */
export interface SystemBundle<
  PropReg extends Record<string, SystemProp>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  Vocab extends string = never,
> {
  system: SystemInstance<PropReg, GroupReg, Conds, Sels, never>;
  createGlobalStyles: GlobalStylesFactory<PropReg>;
  createKeyframes: CreateKeyframesFactory<PropReg>;
  createPositionTry: CreatePositionTryFactory;
  createViewTransitions: CreateViewTransitionsFactory<PropReg>;
  /**
   * The registration key must equal the collection's module-scope export
   * name — references resolve by export name. Registration is linear.
   */
  registerKeyframes<M extends Record<string, RegisterableKeyframes>>(
    map: M &
      LiteralKeyMap<M> & {
        [K in Extract<keyof M, Vocab>]: VocabularyNameCollision<K & string>;
      }
  ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab | (keyof M & string)>;
  /**
   * Keys equal the collection's module-scope export name, as for
   * keyframes; each fallback position emits one `@position-try` rule.
   */
  registerPositionTry<M extends Record<string, RegisterablePositionTries>>(
    map: M &
      LiteralKeyMap<M> & {
        [K in Extract<keyof M, Vocab>]: VocabularyNameCollision<K & string>;
      }
  ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab | (keyof M & string)>;
  /**
   * Keys equal the collection's module-scope export name, as for
   * keyframes; each transition's slots emit view-transition pseudo-element
   * rules scoped to its class.
   */
  registerViewTransitions<
    M extends Record<string, RegisterableViewTransitions>,
  >(
    map: M &
      LiteralKeyMap<M> & {
        [K in Extract<keyof M, Vocab>]: VocabularyNameCollision<K & string>;
      }
  ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab | (keyof M & string)>;
  /**
   * Keys equal the block's module-scope export name. Blocks and keyframes
   * collections share ONE vocabulary name-space. Blocks marked `unlayered`
   * emit after `@layer anm-global`, outside every layer, in registration
   * order.
   */
  registerGlobalStyles<M extends Record<string, RegisterableGlobalStyles>>(
    map: M &
      LiteralKeyMap<M> & {
        [K in Extract<keyof M, Vocab>]: VocabularyNameCollision<K & string>;
      }
  ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab | (keyof M & string)>;
  seal(): SealedSystemInstance<PropReg, GroupReg, Conds, Sels, Vocab>;
}

/**
 * Publishable bundle type whose vocabulary axis is read off the sealed
 * system; a hand-written `LibraryBundle<'…'>` axis is unchecked.
 */
export type LibraryBundleFor<S> = LibraryBundle<VocabularyOf<S>>;

const snapshotTransformBySource = new WeakMap<TransformFn, TransformFn>();
const snapshotTransforms = new WeakSet<TransformFn>();

/**
 * A snapshot is already frozen, so re-snapshotting it across `extend()`
 * returns it: the callable keeps one identity however often it is inherited.
 */
function snapshotTransform(source: TransformFn): TransformFn {
  if (snapshotTransforms.has(source)) return source;
  const cached = snapshotTransformBySource.get(source);
  if (cached) return cached;

  const wrapper: TransformFn = (value, property, props) =>
    source(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: source.name });
  linkAuthoredCallable(wrapper, source);
  // The forwarder body is byte-identical for every transform, so the wrapper
  // presents `source.toString()` — else anonymous transforms compare equal.
  const sourceText = source.toString();
  Object.defineProperty(wrapper, 'toString', {
    value: () => sourceText,
  });
  const named = source as Partial<NamedTransform>;
  if (named.transformName !== undefined) {
    Object.defineProperty(wrapper, 'transformName', {
      value: named.transformName,
      enumerable: true,
    });
  }
  if (named.transformSource !== undefined) {
    Object.defineProperty(wrapper, 'transformSource', {
      value: named.transformSource,
      enumerable: true,
    });
  }
  Object.freeze(wrapper);
  snapshotTransformBySource.set(source, wrapper);
  snapshotTransforms.add(wrapper);
  return wrapper;
}

/**
 * One export for both builders: `createSystem().extend()` takes the system
 * half, `createTheme().extend()` the theme half (`tokens` is accepted too).
 */
export interface LibraryBundle<Vocab extends string = never> {
  system: IncludableSystem;
  theme?: unknown;
  tokens?: unknown;
  /** Phantom vocabulary axis — never present at runtime. */
  readonly __vocabulary?: Vocab;
}

/**
 * A built system also carries a `.system()` chain method, so only
 * `system.toConfig` being callable discriminates a bundle from an instance.
 * The QuickJS capture script in the Rust system-loader reimplements the same
 * discriminator — it cannot import this file, so change both together.
 */
export function isLibraryBundle(value: unknown): value is LibraryBundle {
  const system = (value as { system?: { toConfig?: unknown } } | null)?.system;
  return Boolean(system) && typeof system?.toConfig === 'function';
}

declare const EXTEND_SOURCE_BRAND: unique symbol;

/**
 * Present only on systems Animus built. A private member is dropped from an
 * object spread's type, so a hand-assembled object cannot carry it.
 */
declare class SourceOrigin {
  private readonly __animusSourceOrigin: void;
}

/**
 * What typed `extend()` reads from its source: the registry axes as one
 * record, plus the methods the runtime merge calls. Comparing a whole
 * `SystemInstance` instead expands every component type it can author, so
 * extending a kit cost millions of instantiations; this record keeps the cost
 * near the kit's own. The private origin keeps a forged record, whose
 * snapshot carries none of the registries it claims, out.
 */
export interface ExtendSource<
  PropReg extends Record<string, SystemProp>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  Vocab extends string = never,
>
  extends SourceOrigin, RegistryBrand<Conds, Sels> {
  readonly [EXTEND_SOURCE_BRAND]: {
    readonly props: PropReg;
    readonly groups: GroupReg;
    readonly conditions: Conds;
    readonly selectors: Sels;
    readonly vocabulary: Vocab;
  };
  toConfig(): SerializedConfig;
  getRegistrySnapshot?(): RegistrySnapshot;
  getVocabularyRecord?(): VocabularyRecord;
  readonly [VOCABULARY_BRAND]?: [Vocab];
}

export interface CreateSystemConfig {
  /**
   * @deprecated Use `createSystem().extend(source)`, which merges the
   * source's registries. `includes` adds discovery membership only.
   */
  includes?: readonly IncludableSystem[];
}

declare const STAGE_BRAND: unique symbol;

/**
 * Phantom type-state: `extend()` / `from()` are callable only in
 * `'inherit'`, and every `add*` call advances the builder to `'extend'`.
 */
export type SystemBuilderStage = 'inherit' | 'extend';

/**
 * A group's entry in the group registry: the names of the props it adds,
 * given as the keys of `Props`. `addGroup` passes an object type, so an
 * emitted declaration lists them in the group's own order. A `keyof` union
 * would print in the type checker's order, which changes with the order it
 * checked files in, and so from one declaration build to the next.
 */
export type PropGroup<Name extends string, Props> = Record<
  Name,
  (keyof Props)[]
>;

function orderedPropertiesEqual(
  existing: Prop['properties'],
  incoming: Prop['properties']
): boolean {
  if (existing === incoming) {
    return true;
  }

  if (!existing || !incoming || existing.length !== incoming.length) {
    return false;
  }

  return existing.every((property, index) => property === incoming[index]);
}

function scalesEqual(
  existing: Prop['scale'],
  incoming: Prop['scale']
): boolean {
  if (existing === incoming) return true;
  if (!existing || !incoming || typeof existing !== typeof incoming) {
    return false;
  }
  if (typeof existing === 'string' || typeof incoming === 'string') {
    return false;
  }
  if (Array.isArray(existing) || Array.isArray(incoming)) {
    return (
      Array.isArray(existing) &&
      Array.isArray(incoming) &&
      existing.length === incoming.length &&
      existing.every((value, index) => value === incoming[index])
    );
  }
  const existingMap = existing as Record<string, string | number>;
  const incomingMap = incoming as Record<string, string | number>;
  const existingKeys = Object.keys(existingMap).sort();
  const incomingKeys = Object.keys(incomingMap).sort();
  return (
    orderedMembersEqual(existingKeys, incomingKeys) &&
    existingKeys.every((key) => existingMap[key] === incomingMap[key])
  );
}

function arePropDefinitionsEqual(
  existing: SystemProp,
  incoming: SystemProp,
  structuralScale = false
): boolean {
  if (isDeclarationProp(existing) || isDeclarationProp(incoming)) {
    return (
      isDeclarationProp(existing) &&
      isDeclarationProp(incoming) &&
      existing.scale === incoming.scale &&
      orderedMembersEqual(existing.members, incoming.members)
    );
  }
  return (
    existing.property === incoming.property &&
    orderedPropertiesEqual(existing.properties, incoming.properties) &&
    (structuralScale
      ? scalesEqual(existing.scale, incoming.scale)
      : existing.scale === incoming.scale) &&
    existing.variable === incoming.variable &&
    existing.negative === incoming.negative &&
    existing.strict === incoming.strict &&
    existing.currentVar === incoming.currentVar &&
    areTransformsEqual(existing.transform, incoming.transform)
  );
}

function orderedMembersEqual(
  existing: readonly string[],
  incoming: readonly string[]
): boolean {
  return (
    existing.length === incoming.length &&
    existing.every((member, index) => member === incoming[index])
  );
}

function describePropDefinition(entry: SystemProp): string {
  return isDeclarationProp(entry)
    ? `kind="declarations", scale="${entry.scale}", members="${entry.members.join(',')}"`
    : `property="${entry.property}", scale="${String(entry.scale)}"`;
}

function divergentPropError(
  key: string,
  existing: SystemProp,
  incoming: SystemProp,
  existingOrigin: string,
  incomingOrigin: string
): Error {
  return new Error(
    `Prop "${key}" already registered with a different definition. ` +
      `Existing (${existingOrigin}): ${describePropDefinition(existing)}. ` +
      `Incoming (${incomingOrigin}): ${describePropDefinition(incoming)}.`
  );
}

/** Declaration props with canonical members; value props unchanged. */
function normalizePropConfig<Conf extends Record<string, SystemProp>>(
  config: Conf
): Conf {
  const normalized: Record<string, SystemProp> = {};
  for (const [key, entry] of Object.entries(config)) {
    normalized[key] = isDeclarationProp(entry)
      ? validateDeclarationProp(key, entry)
      : entry;
  }
  return normalized as Conf;
}

export class SystemBuilder<
  PropReg extends Record<string, SystemProp> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
  Conds extends string = never,
  Sels extends string = never,
  Stage extends SystemBuilderStage = 'inherit',
  Vocab extends string = never,
> {
  // Without a member referencing Stage, 'inherit' and 'extend' builders stay
  // mutually assignable and the `this`-typed `from()` gate never fires.
  declare readonly [STAGE_BRAND]?: Stage;

  #propRegistry: PropReg;
  #groupRegistry: GroupReg;
  #selectorRegistry: SelectorAliasMap;
  #includesRegistry: readonly IncludableSystem[];
  #conditionRegistry: ConditionAliasMap;
  // `prop:gap` / `group:space` / `selector:_hover` / `condition:_cardSm` →
  // 1-based index of the `extend()` call; absent means builder state.
  #extendProvenance: ReadonlyMap<string, number>;
  // Count of `extend()` calls — the label index for the next source. An
  // extend whose entries all coalesce still consumes an index.
  #extendCount: number;
  // Vocabulary inherited from sealed sources, in extension order; inherited
  // entries precede local registrations in the sealed record.
  #vocabularyRegistry: readonly VocabularyEntryState[];
  #vocabularyCollisions: readonly VocabularyCollisionEntry[];
  #legacyVerbWitnesses: readonly VocabularyLegacyVerbEntry[];

  constructor(
    propRegistry?: PropReg,
    groupRegistry?: GroupReg,
    selectorRegistry?: SelectorAliasMap,
    includesRegistry?: readonly IncludableSystem[],
    conditionRegistry?: ConditionAliasMap,
    extendProvenance?: ReadonlyMap<string, number>,
    extendCount?: number,
    vocabularyRegistry?: readonly VocabularyEntryState[],
    vocabularyCollisions?: readonly VocabularyCollisionEntry[],
    legacyVerbWitnesses?: readonly VocabularyLegacyVerbEntry[]
  ) {
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
    this.#selectorRegistry = selectorRegistry || { ...BUILT_IN_SELECTORS };
    this.#includesRegistry = includesRegistry || [];
    this.#conditionRegistry = conditionRegistry || { ...BUILT_IN_CONDITIONS };
    this.#extendProvenance = extendProvenance || new Map();
    this.#extendCount = extendCount || 0;
    this.#vocabularyRegistry = vocabularyRegistry || [];
    this.#vocabularyCollisions = vocabularyCollisions || [];
    this.#legacyVerbWitnesses = legacyVerbWitnesses || [];
  }

  #originOf(provenanceKey: string): string {
    const index = this.#extendProvenance.get(provenanceKey);
    return index === undefined ? 'builder state' : `extended source #${index}`;
  }

  /**
   * @deprecated Use `extend(source)`, which merges the source's registries.
   * `from()` admits types and discovery membership only — no merge.
   */
  from<
    SrcProps extends Record<string, SystemProp>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source:
      | SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels, string>
      | {
          system: SystemInstance<
            SrcProps,
            SrcGroups,
            SrcConds,
            SrcSels,
            string
          >;
          theme?: unknown;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit',
    Vocab
  >;
  /**
   * @deprecated Use `extend(source)`. A `LibraryBundle` annotation has
   * already erased the system half's generics — no type surface to admit.
   */
  from(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source: LibraryBundle<string>
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>;
  from(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source: IncludableSystem | { system?: unknown; tokens?: unknown }
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab> {
    const instance = isLibraryBundle(source)
      ? source.system
      : (source as IncludableSystem);
    const fromCount = this.#legacyVerbWitnesses.filter(
      (entry) => entry.verb === 'from'
    ).length;
    const witness = legacyVerbWitness(instance, 'from', fromCount + 1);
    return new SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      [...this.#includesRegistry, instance],
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount,
      this.#vocabularyRegistry,
      this.#vocabularyCollisions,
      witness
        ? [...this.#legacyVerbWitnesses, witness]
        : this.#legacyVerbWitnesses
    );
  }

  /**
   * Merges the source's prop, group, selector, and condition registries;
   * identical entries coalesce, divergent ones throw naming both origins.
   */
  extend<
    SrcProps extends Record<string, SystemProp>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
    SrcVocab extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source:
      | ExtendSource<SrcProps, SrcGroups, SrcConds, SrcSels, SrcVocab>
      | {
          system: ExtendSource<
            SrcProps,
            SrcGroups,
            SrcConds,
            SrcSels,
            SrcVocab
          >;
          theme?: unknown;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit',
    // A source typed through the four-axis `SystemInstance` annotation has
    // vocabulary `string`: unknown, so treated as erased, not as every name.
    Vocab | (string extends SrcVocab ? never : SrcVocab)
  >;
  /**
   * A `LibraryBundle` annotation has erased the system half's generics: the
   * runtime merge is identical, but no source types are admitted.
   */
  extend<SrcVocab extends string = never>(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source: LibraryBundle<SrcVocab>
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab | SrcVocab>;
  extend(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source: IncludableSystem | { system?: unknown; theme?: unknown }
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab> {
    const instance = isLibraryBundle(source)
      ? source.system
      : (source as IncludableSystem);
    const snapshot = instance.getRegistrySnapshot?.();
    if (!snapshot) {
      throw new Error(
        'extend: source system carries no registry snapshot — it was built ' +
          'by an older @animus-ui/system. Rebuild the source against this ' +
          'version (a lossy toConfig() reconstruction is never substituted).'
      );
    }

    const sourceIndex = this.#extendCount + 1;
    const incomingOrigin = `extended source #${sourceIndex}`;
    const provenance = new Map(this.#extendProvenance);

    // A group may be named after one of its own props, as the stock `color`
    // group is; `addGroup` builds it, so extending it must accept it too.
    const groupsByName = this.#groupRegistry as Record<
      string,
      readonly string[]
    >;
    const nextProps: Record<string, SystemProp> = { ...this.#propRegistry };
    for (const [name, incoming] of Object.entries(snapshot.props)) {
      if (name in groupsByName && !groupsByName[name].includes(name)) {
        throw new Error(
          `extend: prop "${name}" (${incomingOrigin}) collides with an ` +
            `existing group name (${this.#originOf(`group:${name}`)}). ` +
            `Group names and prop names must be disjoint.`
        );
      }
      const existing = nextProps[name];
      if (!existing) {
        nextProps[name] = incoming;
        provenance.set(`prop:${name}`, sourceIndex);
      } else if (!arePropDefinitionsEqual(existing, incoming, true)) {
        throw divergentPropError(
          name,
          existing,
          incoming,
          this.#originOf(`prop:${name}`),
          incomingOrigin
        );
      }
    }

    const nextGroups: Record<string, readonly string[]> = {
      ...(this.#groupRegistry as Record<string, readonly string[]>),
    };
    for (const [name, incoming] of Object.entries(snapshot.groups)) {
      const existing = nextGroups[name];
      if (!existing) {
        if (name in nextProps && !incoming.includes(name)) {
          throw new Error(
            `extend: group name "${name}" (${incomingOrigin}) collides with ` +
              `an existing prop name (${this.#originOf(`prop:${name}`)}). ` +
              `Group names and prop names must be disjoint.`
          );
        }
        nextGroups[name] = [...incoming];
        provenance.set(`group:${name}`, sourceIndex);
      } else if (!orderedMembersEqual(existing, incoming)) {
        throw new Error(
          `extend: group "${name}" already registered with different ` +
            `membership. ` +
            `Existing (${this.#originOf(`group:${name}`)}): [${existing.join(', ')}]. ` +
            `Incoming (${incomingOrigin}): [${incoming.join(', ')}].`
        );
      }
    }

    // Every source carries the seeded built-ins, so an entry identical to its
    // built-in default is inert; a pristine built-in yields to an override.
    const selectorOverrides: SelectorAliasMap = {};
    const newSelectors: Record<string, string> = {};
    for (const [name, incoming] of Object.entries(snapshot.selectors)) {
      const builtIn = BUILT_IN_SELECTORS[name];
      if (builtIn && builtIn.selector === incoming.selector) {
        continue;
      }
      if (name in this.#conditionRegistry) {
        throw new Error(
          `extend: selector alias "${name}" (${incomingOrigin}) is already ` +
            `registered as a condition alias ` +
            `(${this.#originOf(`condition:${name}`)}); a name resolves ` +
            `through exactly one registry. Pick a distinct name.`
        );
      }
      const existing = this.#selectorRegistry[name];
      if (!existing) {
        newSelectors[name] = incoming.selector;
        provenance.set(`selector:${name}`, sourceIndex);
      } else if (existing.selector !== incoming.selector) {
        const existingIndex = provenance.get(`selector:${name}`);
        if (existingIndex === undefined) {
          // No provenance means a pristine built-in: the source's override
          // wins and keeps the built-in order.
          selectorOverrides[name] = {
            selector: incoming.selector,
            order: existing.order,
          };
          provenance.set(`selector:${name}`, sourceIndex);
        } else {
          throw new Error(
            `extend: selector alias "${name}" already registered with a ` +
              `different selector. ` +
              `Existing (extended source #${existingIndex}): "${existing.selector}". ` +
              `Incoming (${incomingOrigin}): "${incoming.selector}".`
          );
        }
      }
    }
    const nextSelectors = mergeSelectors(
      { ...this.#selectorRegistry, ...selectorOverrides },
      newSelectors
    );

    // Equality is keyed on `value`; `order` is a per-registry accident.
    const conditionOverrides: ConditionAliasMap = {};
    const newConditions: Record<string, string> = {};
    for (const [name, incoming] of Object.entries(snapshot.conditions)) {
      const builtIn = BUILT_IN_CONDITIONS[name];
      if (builtIn && builtIn.value === incoming.value) {
        continue;
      }
      if (name in nextSelectors) {
        throw new Error(
          `extend: condition alias "${name}" (${incomingOrigin}) is already ` +
            `registered as a selector alias ` +
            `(${this.#originOf(`selector:${name}`)}); a name resolves ` +
            `through exactly one registry. Pick a distinct name.`
        );
      }
      const existing = this.#conditionRegistry[name];
      if (!existing) {
        newConditions[name] = incoming.value;
        provenance.set(`condition:${name}`, sourceIndex);
      } else if (existing.value !== incoming.value) {
        const existingIndex = provenance.get(`condition:${name}`);
        if (existingIndex === undefined) {
          conditionOverrides[name] = {
            value: incoming.value,
            order: existing.order,
            kind: incoming.kind,
          };
          provenance.set(`condition:${name}`, sourceIndex);
        } else {
          throw new Error(
            `extend: condition alias "${name}" already registered with a ` +
              `different condition. ` +
              `Existing (extended source #${existingIndex}): "${existing.value}". ` +
              `Incoming (${incomingOrigin}): "${incoming.value}".`
          );
        }
      }
    }
    const nextConditions = mergeConditions(
      { ...this.#conditionRegistry, ...conditionOverrides },
      newConditions,
      new Set(Object.keys(nextSelectors))
    );

    const sourceRecord = (
      instance as { getVocabularyRecord?(): VocabularyRecord }
    ).getVocabularyRecord?.();
    if (!sourceRecord) {
      throw new Error(
        'extend: source system is not sealed (or was built by an older ' +
          '@animus-ui/system) — registered vocabulary travels only on ' +
          'sealed instances. Call seal() on the source bundle and export ' +
          'the sealed instance.'
      );
    }
    let nextVocabulary = this.#vocabularyRegistry;
    let nextVocabularyCollisions = this.#vocabularyCollisions;
    const inheritedEntries: VocabularyEntryInput[] = [
      ...sourceRecord.keyframes.map((entry) => ({
        kind: 'keyframes' as const,
        name: entry.name,
        frames: entry.frames,
      })),
      ...(sourceRecord.positionTries ?? []).map((entry) => ({
        kind: 'positionTry' as const,
        name: entry.name,
        tries: entry.tries,
      })),
      ...(sourceRecord.viewTransitions ?? []).map((entry) => ({
        kind: 'viewTransitions' as const,
        name: entry.name,
        transitions: entry.transitions,
      })),
      ...sourceRecord.globalStyles.map((entry) => ({
        kind: 'globalStyles' as const,
        name: entry.name,
        styles: entry.styles,
        ...(entry.fontFaces ? { fontFaces: entry.fontFaces } : {}),
        ...(entry.unlayered ? { unlayered: true as const } : {}),
      })),
    ];
    if (inheritedEntries.length > 0) {
      const merged = mergeVocabularyEntries(
        this.#vocabularyRegistry,
        this.#vocabularyCollisions,
        inheritedEntries,
        incomingOrigin
      );
      nextVocabulary = merged.entries;
      nextVocabularyCollisions = merged.collisions;
    }

    return new SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>(
      nextProps as PropReg,
      nextGroups as GroupReg,
      nextSelectors,
      [...this.#includesRegistry, instance],
      nextConditions,
      provenance,
      sourceIndex,
      nextVocabulary,
      nextVocabularyCollisions,
      this.#legacyVerbWitnesses
    );
  }

  /**
   * Registers `_` aliases → `&`-relative selectors. The cross-registry clash
   * is checked in VALUE position: `Exclude` on a `_${string}` key is a no-op.
   */
  addSelectors<S extends Record<`_${string}`, string>>(
    selectors: S & {
      [K in keyof S]: K extends BuiltInConditionAlias | NarrowedAliases<Conds>
        ? ReservedByConditionRegistry<K & string>
        : S[K];
    }
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds,
    Sels | NarrowedAliases<Extract<keyof S, string>>,
    'extend',
    Vocab
  > {
    // Rust dispatch prefers selector aliases, so re-registering a condition
    // name as a selector would make the condition silently never resolve.
    for (const name of Object.keys(selectors)) {
      if (name in this.#conditionRegistry) {
        throw new Error(
          `addSelectors: "${name}" is already registered as a condition alias; ` +
            'a name resolves through exactly one registry. Pick a distinct name.'
        );
      }
    }
    const merged = mergeSelectors(this.#selectorRegistry, selectors);
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds,
      Sels | NarrowedAliases<Extract<keyof S, string>>,
      'extend',
      Vocab
    >(
      this.#propRegistry,
      this.#groupRegistry,
      merged,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount,
      this.#vocabularyRegistry,
      this.#vocabularyCollisions,
      this.#legacyVerbWitnesses
    );
  }

  /**
   * Registers `_` aliases → at-rule strings; user aliases override built-ins
   * of the same name. A selector-owned key maps to the branded rejection.
   */
  addConditions<C extends Record<`_${string}`, AtRuleValue>>(
    conditions: C & {
      [K in keyof C]: K extends BuiltInSelectorAlias | NarrowedAliases<Sels>
        ? ReservedBySelectorRegistry<K & string>
        : C[K];
    }
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds | NarrowedAliases<Extract<keyof C, string>>,
    Sels,
    'extend',
    Vocab
  > {
    const merged = mergeConditions(
      this.#conditionRegistry,
      conditions,
      new Set(Object.keys(this.#selectorRegistry))
    );
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds | NarrowedAliases<Extract<keyof C, string>>,
      Sels,
      'extend',
      Vocab
    >(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      merged,
      this.#extendProvenance,
      this.#extendCount,
      this.#vocabularyRegistry,
      this.#vocabularyCollisions,
      this.#legacyVerbWitnesses
    );
  }

  addGroup<Name extends string, Conf extends Record<string, SystemProp>>(
    name: Name extends keyof PropReg ? never : Name,
    authored: Conf
  ): SystemBuilder<
    PropReg & Conf,
    GroupReg & PropGroup<Name, { [Prop in keyof Conf]: true }>,
    Conds,
    Sels,
    'extend',
    Vocab
  > {
    if (name in this.#propRegistry) {
      throw new Error(
        `Group name "${name}" collides with an existing prop name. ` +
          `Group names and prop names must be disjoint.`
      );
    }
    const config = normalizePropConfig(authored);

    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, SystemProp>)[
          key
        ];
        const incoming = config[key];
        // Extended entries carry a frozen COPY of their scale, so identity
        // comparison would false-conflict a byte-identical re-registration.
        const viaExtend = this.#extendProvenance.has(`prop:${key}`);
        if (!arePropDefinitionsEqual(existing, incoming, viaExtend)) {
          if (this.#extendProvenance.has(`prop:${key}`)) {
            throw divergentPropError(
              key,
              existing,
              incoming,
              this.#originOf(`prop:${key}`),
              'builder state'
            );
          }
          throw new Error(
            `Prop "${key}" already registered with a different definition. ` +
              `Existing: ${describePropDefinition(existing)}. ` +
              `Incoming: ${describePropDefinition(incoming)}.`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    const newGroup = {
      [name]: Object.keys(config),
    } as PropGroup<Name, { [Prop in keyof Conf]: true }>;
    const nextGroups = { ...this.#groupRegistry, ...newGroup };

    return new SystemBuilder<
      PropReg & Conf,
      GroupReg & PropGroup<Name, { [Prop in keyof Conf]: true }>,
      Conds,
      Sels,
      'extend',
      Vocab
    >(
      nextProps,
      nextGroups,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount,
      this.#vocabularyRegistry,
      this.#vocabularyCollisions,
      this.#legacyVerbWitnesses
    );
  }

  addProps<
    Conf extends Record<string, SystemProp> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(
    authored: Conf
  ): SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend', Vocab> {
    for (const key of Object.keys(authored)) {
      if (key in this.#groupRegistry) {
        throw new Error(
          `Prop name "${key}" collides with an existing group name. ` +
            `Group names and prop names must be disjoint.`
        );
      }
    }
    const config = normalizePropConfig(authored);

    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, SystemProp>)[
          key
        ];
        const incoming = (config as Record<string, SystemProp>)[key];
        const viaExtend = this.#extendProvenance.has(`prop:${key}`);
        if (!arePropDefinitionsEqual(existing, incoming, viaExtend)) {
          if (this.#extendProvenance.has(`prop:${key}`)) {
            throw divergentPropError(
              key,
              existing,
              incoming,
              this.#originOf(`prop:${key}`),
              'builder state'
            );
          }
          throw new Error(
            `Prop "${key}" already registered with a different definition.`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    return new SystemBuilder<
      PropReg & Conf,
      GroupReg,
      Conds,
      Sels,
      'extend',
      Vocab
    >(
      nextProps,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount,
      this.#vocabularyRegistry,
      this.#vocabularyCollisions,
      this.#legacyVerbWitnesses
    );
  }

  build(): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> {
    // Captured ONCE here — re-reading builder or caller state at seal time
    // opens a build→seal divergence; minted instances get their own copies.
    const propSource = Object.fromEntries(
      Object.entries(this.#propRegistry).map(([key, entry]) => [
        key,
        { ...entry },
      ])
    ) as PropReg;
    const groupSource = Object.fromEntries(
      Object.entries(this.#groupRegistry).map(([key, members]) => [
        key,
        [...(members as readonly string[])],
      ])
    ) as GroupReg;
    const snapshot = createRegistrySnapshot(
      this.#propRegistry,
      this.#groupRegistry as Record<string, readonly string[]>,
      this.#selectorRegistry,
      this.#conditionRegistry
    );

    const mintInstance = (): SystemInstance<
      PropReg,
      GroupReg,
      Conds,
      Sels,
      never
    > => {
      const animus = new Animus<PropReg, GroupReg>(
        Object.fromEntries(
          Object.entries(propSource).map(([key, entry]) => [key, { ...entry }])
        ) as PropReg,
        Object.fromEntries(
          Object.entries(groupSource).map(([key, members]) => [
            key,
            [...(members as readonly string[])],
          ])
        ) as GroupReg
      );

      const instance = Object.assign(animus, {
        toConfig: (): SerializedConfig => {
          return serializeInstance(
            snapshot.props,
            snapshot.groups,
            snapshot.selectors,
            snapshot.conditions
          );
        },
      }) as SystemInstance<PropReg, GroupReg, Conds, Sels, never>;

      // Non-enumerable: the QuickJS capture script's discriminators walk
      // enumerable keys only.
      Object.defineProperty(instance, 'getRegistrySnapshot', {
        value: (): RegistrySnapshot => snapshot,
        enumerable: false,
      });

      return instance;
    };

    const system = mintInstance();
    const legacyVerbWitnessRecord = this.#legacyVerbWitnesses;

    const createGlobalStyles = ((
      styles: GlobalStyleMap | readonly FontFace[],
      options?: { fontFaces?: readonly FontFace[]; unlayered?: boolean }
    ): GlobalStyleBlock => {
      // An array of faces alone is a block of those faces and no rules.
      const [map, fontFaces] = Array.isArray(styles)
        ? [{}, styles as readonly FontFace[]]
        : [styles as GlobalStyleMap, options?.fontFaces];
      return {
        __brand: 'GlobalStyleBlock' as const,
        styles: map,
        ...(fontFaces?.length ? { fontFaces: [...fontFaces] } : {}),
        ...(options?.unlayered ? { unlayered: true as const } : {}),
      };
    }) as GlobalStylesFactory<PropReg>;

    const createKeyframes = ((frames: Record<string, KeyframeFrameMap>) =>
      keyframesImpl(frames)) as CreateKeyframesFactory<PropReg>;
    const createPositionTry: CreatePositionTryFactory = positionTriesImpl;
    const createViewTransitions = ((
      transitions: Record<string, ViewTransitionSlots>
    ) =>
      viewTransitionsImpl(
        transitions
      )) as CreateViewTransitionsFactory<PropReg>;

    const makeBundle = (
      entries: readonly VocabularyEntryState[],
      collisions: readonly VocabularyCollisionEntry[],
      localCallCount: number
    ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
      let consumedBy: 'register' | 'seal' | undefined;

      const registerEntries = (
        label: string,
        incoming: VocabularyEntryInput[]
      ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
        if (consumedBy === 'seal') {
          throw new Error(
            `${label}: this system is already sealed — registration ` +
              'happens between build() and seal().'
          );
        }
        if (consumedBy === 'register') {
          throw new Error(
            `${label}: this bundle was superseded by a later registration ` +
              'call — registration is linear; chain the calls and seal the ' +
              'final bundle.'
          );
        }
        const merged = mergeVocabularyEntries(
          entries,
          collisions,
          incoming,
          `local registration #${localCallCount + 1}`
        );
        consumedBy = 'register';
        return makeBundle(
          merged.entries,
          merged.collisions,
          localCallCount + 1
        );
      };

      const registerKeyframes = (
        map: Record<string, RegisterableKeyframes>
      ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
        const incoming = registeredPayloads<KeyframesFrameData>(
          'registerKeyframes',
          'createKeyframes',
          'Keyframes',
          '__frames',
          map
        ).map(([name, frames]): VocabularyEntryInput => ({
          kind: 'keyframes',
          name,
          frames: snapshotEntries(frames, (entry) => ({
            name: entry.name,
            frames: freezeBlocks(entry.frames ?? {}),
          })),
        }));
        return registerEntries('registerKeyframes', incoming);
      };

      const registerPositionTry = (
        map: Record<string, RegisterablePositionTries>
      ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
        const incoming = registeredPayloads<PositionTryData>(
          'registerPositionTry',
          'createPositionTry',
          'PositionTries',
          '__tries',
          map
        ).map(([name, tries]): VocabularyEntryInput => ({
          kind: 'positionTry',
          name,
          tries: snapshotEntries(tries, (entry) => ({
            name: entry.name,
            descriptors: Object.freeze({ ...entry.descriptors }),
          })),
        }));
        return registerEntries('registerPositionTry', incoming);
      };

      const registerViewTransitions = (
        map: Record<string, RegisterableViewTransitions>
      ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
        // Each slot's block is frozen; deeper blocks alias, as a
        // global-style block's do.
        const incoming = registeredPayloads<ViewTransitionData>(
          'registerViewTransitions',
          'createViewTransitions',
          'ViewTransitions',
          '__transitions',
          map
        ).map(([name, transitions]): VocabularyEntryInput => ({
          kind: 'viewTransitions',
          name,
          transitions: snapshotEntries(transitions, (entry) => ({
            name: entry.name,
            slots: freezeBlocks(entry.slots),
          })),
        }));
        return registerEntries('registerViewTransitions', incoming);
      };

      const registerGlobalStyles = (
        map: Record<string, RegisterableGlobalStyles>
      ): SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab> => {
        const incoming: VocabularyEntryInput[] = [];
        for (const [name, block] of Object.entries(map)) {
          if (
            !block ||
            (block as { __brand?: unknown }).__brand !== 'GlobalStyleBlock' ||
            typeof (block as { styles?: unknown }).styles !== 'object'
          ) {
            throw new TypeError(
              `registerGlobalStyles: "${name}" is not a createGlobalStyles ` +
                'block — register the factory return value itself.'
            );
          }
          const blockValue = block as unknown as GlobalStyleBlock;
          // Copied and frozen two levels deep; deeper selector bodies stay
          // aliased.
          const styles = Object.freeze(
            Object.fromEntries(
              Object.entries(blockValue.styles).map(([selector, body]) => [
                selector,
                Object.freeze({ ...body }),
              ])
            )
          ) as GlobalStyleMap;
          incoming.push({
            kind: 'globalStyles',
            name,
            styles,
            ...(blockValue.fontFaces?.length
              ? {
                  fontFaces: Object.freeze(
                    blockValue.fontFaces.map((face) =>
                      Object.freeze({ ...face })
                    )
                  ) as readonly FontFace[],
                }
              : {}),
            ...(blockValue.unlayered ? { unlayered: true as const } : {}),
          });
        }
        return registerEntries('registerGlobalStyles', incoming);
      };

      const seal = (): SealedSystemInstance<
        PropReg,
        GroupReg,
        Conds,
        Sels,
        Vocab
      > => {
        if (consumedBy === 'seal') {
          throw new Error(
            'seal: this system is already sealed — seal() returns exactly ' +
              'one instance per build().'
          );
        }
        if (consumedBy === 'register') {
          throw new Error(
            'seal: this bundle was superseded by a later registration call ' +
              '— registration is linear; seal the final bundle.'
          );
        }
        const positionTries = entries
          .filter((entry) => entry.kind === 'positionTry')
          .map((entry) =>
            Object.freeze({ name: entry.name, tries: entry.tries })
          );
        const viewTransitions = entries
          .filter((entry) => entry.kind === 'viewTransitions')
          .map((entry) =>
            Object.freeze({ name: entry.name, transitions: entry.transitions })
          );
        const record: VocabularyRecord = Object.freeze({
          version:
            positionTries.length > 0 || viewTransitions.length > 0 ? 2 : 1,
          ...(positionTries.length > 0
            ? { positionTries: Object.freeze(positionTries) }
            : {}),
          ...(viewTransitions.length > 0
            ? { viewTransitions: Object.freeze(viewTransitions) }
            : {}),
          keyframes: Object.freeze(
            entries
              .filter((entry) => entry.kind === 'keyframes')
              .map((entry) =>
                // Frames arrive deep-copied and frozen, from registration or
                // from a sealed source's record.
                Object.freeze({ name: entry.name, frames: entry.frames })
              )
          ),
          globalStyles: Object.freeze(
            entries
              .filter((entry) => entry.kind === 'globalStyles')
              .map((entry) =>
                Object.freeze({
                  name: entry.name,
                  styles: entry.styles,
                  ...(entry.fontFaces ? { fontFaces: entry.fontFaces } : {}),
                  ...(entry.unlayered ? { unlayered: true as const } : {}),
                })
              )
          ),
          collisions: Object.freeze(
            collisions.map((entry) => Object.freeze({ ...entry }))
          ),
          legacyVerbs: Object.freeze(
            legacyVerbWitnessRecord
              // A name that DID arrive through a separate `.extend()` must
              // not be claimed undelivered — keep only refused names.
              .map((entry) => ({
                ...entry,
                names: entry.names.filter(
                  (name) => !entries.some((kept) => kept.name === name)
                ),
              }))
              .filter((entry) => entry.names.length > 0)
              .map((entry) =>
                Object.freeze({
                  ...entry,
                  names: Object.freeze([...entry.names]),
                })
              )
          ),
        });

        const sealed = mintInstance() as SealedSystemInstance<
          PropReg,
          GroupReg,
          Conds,
          Sels,
          Vocab
        >;
        // Non-enumerable: the QuickJS capture script's discriminators walk
        // enumerable keys only.
        Object.defineProperty(sealed, 'getVocabularyRecord', {
          value: (): VocabularyRecord => record,
          enumerable: false,
        });
        // Runtime-only stub, absent from the sealed TYPE: registering on a
        // sealed instance names the sealed state, not "not a function".
        for (const member of [
          'registerKeyframes',
          'registerPositionTry',
          'registerViewTransitions',
          'registerGlobalStyles',
        ]) {
          Object.defineProperty(sealed, member, {
            value: (): never => {
              throw new Error(
                `${member}: this system is sealed — registration happens ` +
                  'between build() and seal().'
              );
            },
            enumerable: false,
          });
        }
        consumedBy = 'seal';
        return sealed;
      };

      return {
        system,
        createGlobalStyles,
        createKeyframes,
        createPositionTry,
        createViewTransitions,
        registerKeyframes,
        registerPositionTry,
        registerViewTransitions,
        registerGlobalStyles,
        seal,
      } as SystemBundle<PropReg, GroupReg, Conds, Sels, Vocab>;
    };

    return makeBundle(
      this.#vocabularyRegistry.map((entry) => ({ ...entry })),
      [...this.#vocabularyCollisions],
      0
    );
  }
}

export type SystemInstance<
  PropReg extends Record<string, SystemProp>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  // Unknown by default, so the four-axis annotation accepts any built system.
  Vocab extends string = string,
> = Animus<PropReg, GroupReg> & {
  toConfig(): SerializedConfig;
  /**
   * Frozen registry state captured at `build()` — what `extend()` merges
   * from. Optional only for systems built by an older @animus-ui/system.
   */
  getRegistrySnapshot?(): RegistrySnapshot;
} & RegistryBrand<Conds, Sels> &
  ExtendSource<PropReg, GroupReg, Conds, Sels, Vocab>;

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  /** Bound callables by definition id. */
  transforms: Record<string, NamedTransform>;
  /**
   * `{ definitionId: sourceText }` — the only channel by which transforms
   * shipped inside a package reach the build-time evaluator.
   */
  transformSources: string;
  selectorAliases: string;
  /** Condition alias map JSON: `alias → { value, order, kind }`. */
  conditionAliases: string;
}

/**
 * Copies and freezes containers, entries, and the mutable values inside a
 * prop, so later mutation reaches neither serialized nor merged output.
 */
function createRegistrySnapshot(
  propRegistry: Record<string, SystemProp>,
  groupRegistry: Record<string, readonly string[]>,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): RegistrySnapshot {
  const props: Record<string, SystemProp> = {};
  for (const [name, entry] of Object.entries(propRegistry)) {
    if (isDeclarationProp(entry)) {
      props[name] = Object.freeze({
        ...entry,
        members: Object.freeze([...entry.members]),
      });
      continue;
    }
    const copy: Prop = { ...entry };
    if (copy.properties) {
      copy.properties = Object.freeze([
        ...copy.properties,
      ]) as unknown as Prop['properties'];
    }
    if (copy.scale && typeof copy.scale === 'object') {
      copy.scale = Object.freeze(
        Array.isArray(copy.scale) ? [...copy.scale] : { ...copy.scale }
      ) as unknown as Prop['scale'];
    }
    if (copy.transform) {
      copy.transform = snapshotTransform(copy.transform);
    }
    props[name] = Object.freeze(copy);
  }
  const groups: Record<string, readonly string[]> = {};
  for (const [name, members] of Object.entries(groupRegistry)) {
    groups[name] = Object.freeze([...members]);
  }
  const selectors: SelectorAliasMap = {};
  for (const [name, entry] of Object.entries(selectorRegistry)) {
    selectors[name] = Object.freeze({ ...entry });
  }
  const conditions: ConditionAliasMap = {};
  for (const [name, entry] of Object.entries(conditionRegistry)) {
    conditions[name] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    props: Object.freeze(props),
    groups: Object.freeze(groups),
    selectors: Object.freeze(selectors),
    conditions: Object.freeze(conditions),
  });
}

/**
 * A configured definition's identity: its system provenance is the first of
 * its bound props in sorted order, so registration order, unrelated props and
 * callback edits leave it unchanged. The readable name is carried for
 * legibility; the prop alone keeps two same-named definitions apart.
 */
function transformDefinitionId(name: string, props: readonly string[]): string {
  const [owner] = [...props].sort();
  return `${name}@system.${owner}`;
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, readonly string[]>,
>(
  propRegistry: PropReg,
  groupRegistry: GroupReg,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): SerializedConfig {
  const serialized: Record<string, SerializedPropEntry> = {};
  // Keyed by callable identity: equal names or equal source text never make
  // two callables one definition.
  const definitions = new Map<TransformFn, { name: string; props: string[] }>();

  for (const [propName, entry] of Object.entries(propRegistry)) {
    if (isDeclarationProp(entry)) {
      serialized[propName] = {
        kind: 'declarations',
        scale: entry.scale,
        members: [...entry.members],
      };
      continue;
    }
    const s: SerializedValuePropEntry = { property: (entry as any).property };

    if ((entry as any).properties && (entry as any).properties.length > 0) {
      s.properties = [...(entry as any).properties];
    }

    const scale = (entry as any).scale;
    if (typeof scale === 'string') {
      s.scale = scale;
    } else if (scale && typeof scale === 'object') {
      s.scale = scale;
    }

    if ((entry as any).negative) {
      s.negative = true;
    }

    if (s.scale !== undefined && (entry as any).strict !== false) {
      s.strict = true;
    }

    if ((entry as any).transform) {
      const fn: TransformFn = (entry as any).transform;
      const name = (fn as Partial<NamedTransform>).transformName ?? fn.name;
      if (name) {
        s.transform = name;
        const definition = definitions.get(fn);
        if (definition) definition.props.push(propName);
        else definitions.set(fn, { name, props: [propName] });
      }
    }

    if ((entry as any).currentVar) {
      s.currentVar = (entry as any).currentVar;
    }

    serialized[propName] = s;
  }

  const { selectors } = serializeSelectorMap(selectorRegistry);
  const conditions = serializeConditionMap(conditionRegistry);

  const transforms: Record<string, NamedTransform> = {};
  // Extraction evaluates transforms in a sandbox seeded only from source
  // text; without these a packaged transform silently falls back to raw values.
  const transformSources: Record<string, string> = {};
  for (const [fn, { name, props }] of definitions) {
    const id = transformDefinitionId(name, props);
    for (const propName of props) {
      (serialized[propName] as SerializedValuePropEntry).transformId = id;
    }
    transforms[id] = fn as NamedTransform;
    const source = (fn as Partial<NamedTransform>).transformSource;
    // Absent only on instances built by an older @animus-ui/system; skipping
    // leaves the raw-value fallback instead of the forwarder body.
    if (source !== undefined) transformSources[id] = source;
  }

  return {
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
    transformSources: JSON.stringify(transformSources),
    selectorAliases: JSON.stringify(selectors),
    conditionAliases: JSON.stringify(conditions),
  };
}

export function createSystem(config?: CreateSystemConfig): SystemBuilder {
  const includes = config?.includes ?? [];
  const witnesses: VocabularyLegacyVerbEntry[] = [];
  includes.forEach((source, index) => {
    const witness = legacyVerbWitness(source, 'includes', index + 1);
    if (witness) witnesses.push(witness);
  });
  return new SystemBuilder(
    undefined,
    undefined,
    undefined,
    includes,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    witnesses
  );
}
