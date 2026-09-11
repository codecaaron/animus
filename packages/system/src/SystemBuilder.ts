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
import {
  type KeyframeFrameMap,
  type Keyframes,
  keyframes as keyframesImpl,
} from './keyframes';
import {
  BUILT_IN_SELECTORS,
  mergeSelectors,
  type SelectorAliasMap,
  serializeSelectorMap,
} from './selectors';
import {
  areTransformsEqual,
  NamedTransform,
  TransformFn,
} from './transforms/createTransform';
import {
  type BuiltInConditionAlias,
  type BuiltInSelectorAlias,
  Prop,
  ThemedCSSProps,
} from './types/config';
import { AbstractProps } from './types/props';

interface SerializedPropEntry {
  property: string;
  properties?: string[];
  scale?: string | Record<string, string | number> | (string | number)[];
  transform?: string;
  currentVar?: string;
  negative?: boolean;
}

export type GlobalStyleMap = Record<string, Record<string, any>>;

export interface FontFaceSrc {
  /**
   * A literal string is emitted byte-exact; an `AssetRef` emits its
   * placeholder string, which the host plugin substitutes after extraction.
   */
  url: string | AssetRef;
  /** Format hint (`woff2`, `woff`, …), rendered as `format('…')`. */
  format?: string;
}

/**
 * `family` may use a font-scale token reference (`{fonts.body}`); the other
 * descriptors take CSS literals only.
 */
export interface FontFace {
  family: string;
  src: FontFaceSrc[];
  weight?: string;
  style?: string;
  display?: string;
  unicodeRange?: string;
  stretch?: string;
}

export interface GlobalStyleBlock {
  __brand: 'GlobalStyleBlock';
  styles: GlobalStyleMap;
  /** Rendered ahead of the block's selector rules in `@layer anm-global`. */
  fontFaces?: FontFace[];
}

export type GlobalStylesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Map extends Record<string, AbstractProps>>(
  styles: {
    readonly [K in keyof Map]: ThemedCSSProps<Map[K], PropReg>;
  },
  options?: { fontFaces?: readonly FontFace[] }
) => GlobalStyleBlock;

export type CreateKeyframesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Frames extends Record<string, Record<string, AbstractProps>>>(frames: {
  readonly [N in keyof Frames]: {
    readonly [S in keyof Frames[N]]: ThemedCSSProps<Frames[N][S], PropReg>;
  };
}) => Keyframes<{
  readonly [N in keyof Frames]: KeyframeFrameMap;
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
  props: Record<string, Prop>;
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

export interface VocabularyGlobalStyleEntry {
  readonly name: string;
  readonly styles: GlobalStyleMap;
  readonly fontFaces?: readonly FontFace[];
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
 * The loader reads registered collections exclusively from here.
 */
export interface VocabularyRecord {
  readonly version: 1;
  readonly keyframes: readonly VocabularyKeyframesEntry[];
  readonly globalStyles: readonly VocabularyGlobalStyleEntry[];
  readonly collisions: readonly VocabularyCollisionEntry[];
  readonly legacyVerbs: readonly VocabularyLegacyVerbEntry[];
}

/** ONE name-space across both kinds: a global-style block and a keyframes
 *  collection cannot share a registered name. */
type VocabularyEntryState =
  | {
      kind: 'keyframes';
      name: string;
      frames: KeyframesFrameData;
      origin: string;
    }
  | {
      kind: 'globalStyles';
      name: string;
      styles: GlobalStyleMap;
      fontFaces?: readonly FontFace[];
      origin: string;
    };

type VocabularyEntryInput =
  | { kind: 'keyframes'; name: string; frames: KeyframesFrameData }
  | {
      kind: 'globalStyles';
      name: string;
      styles: GlobalStyleMap;
      fontFaces?: readonly FontFace[];
    };

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

/**
 * Frozen two levels deep (frame entries + stop bodies) so later mutation of
 * the caller's collection cannot reach a sealed record; deeper values alias.
 */
function snapshotFrameData(frames: KeyframesFrameData): KeyframesFrameData {
  const copy: Record<string, { name: string; frames: KeyframeFrameMap }> = {};
  for (const [key, entry] of Object.entries(frames)) {
    const stops: KeyframeFrameMap = {};
    for (const [stop, body] of Object.entries(entry.frames ?? {})) {
      stops[stop] = Object.freeze({ ...body }) as KeyframeFrameMap[string];
    }
    copy[key] = Object.freeze({
      name: entry.name,
      frames: Object.freeze(stops) as KeyframeFrameMap,
    });
  }
  return Object.freeze(copy) as KeyframesFrameData;
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
 */
export type SealedSystemInstance<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  Vocab extends string = never,
> = SystemInstance<PropReg, GroupReg, Conds, Sels> & {
  getVocabularyRecord(): VocabularyRecord;
  readonly [VOCABULARY_BRAND]?: Vocab;
};

export type VocabularyOf<S> = S extends {
  readonly [VOCABULARY_BRAND]?: infer V;
}
  ? Extract<V, string>
  : never;

/**
 * The `build()` return. Registration is linear — chain the returned bundle;
 * one `seal()` per bundle, and later registering or re-sealing throws.
 */
export interface SystemBundle<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
  Vocab extends string = never,
> {
  system: SystemInstance<PropReg, GroupReg, Conds, Sels>;
  createGlobalStyles: GlobalStylesFactory<PropReg>;
  createKeyframes: CreateKeyframesFactory<PropReg>;
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
   * Keys equal the block's module-scope export name. Blocks and keyframes
   * collections share ONE vocabulary name-space.
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

function snapshotTransform(source: TransformFn): TransformFn {
  const cached = snapshotTransformBySource.get(source);
  if (cached) return cached;

  const wrapper: TransformFn = (value, property, props) =>
    source(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: source.name });
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
 */
export function isLibraryBundle(value: unknown): value is LibraryBundle {
  const system = (value as { system?: { toConfig?: unknown } } | null)?.system;
  return Boolean(system) && typeof system?.toConfig === 'function';
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
  existing: Prop,
  incoming: Prop,
  structuralScale = false
): boolean {
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

function divergentPropError(
  key: string,
  existing: Prop,
  incoming: Prop,
  existingOrigin: string,
  incomingOrigin: string
): Error {
  return new Error(
    `Prop "${key}" already registered with a different definition. ` +
      `Existing (${existingOrigin}): property="${existing.property}", scale="${String(existing.scale)}". ` +
      `Incoming (${incomingOrigin}): property="${incoming.property}", scale="${String(incoming.scale)}".`
  );
}

export class SystemBuilder<
  PropReg extends Record<string, Prop> = {},
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
    SrcProps extends Record<string, Prop>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source:
      | SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>
      | {
          system: SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>;
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
    SrcProps extends Record<string, Prop>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
    SrcVocab extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit', Vocab>,
    source:
      | (SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels> & {
          readonly [VOCABULARY_BRAND]?: SrcVocab;
        })
      | {
          system: SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels> & {
            readonly [VOCABULARY_BRAND]?: SrcVocab;
          };
          theme?: unknown;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit',
    Vocab | SrcVocab
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

    const nextProps: Record<string, Prop> = { ...this.#propRegistry };
    for (const [name, incoming] of Object.entries(snapshot.props)) {
      if (name in this.#groupRegistry) {
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
        if (name in nextProps) {
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
      ...sourceRecord.globalStyles.map((entry) => ({
        kind: 'globalStyles' as const,
        name: entry.name,
        styles: entry.styles,
        ...(entry.fontFaces ? { fontFaces: entry.fontFaces } : {}),
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

  addGroup<Name extends string, Conf extends Record<string, Prop>>(
    name: Name extends keyof PropReg ? never : Name,
    config: Conf
  ): SystemBuilder<
    PropReg & Conf,
    GroupReg & Record<Name, (keyof Conf)[]>,
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

    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
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
              `Existing: property="${existing.property}", scale="${String(existing.scale)}". ` +
              `Incoming: property="${incoming.property}", scale="${String(incoming.scale)}".`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    const newGroup = {
      [name]: Object.keys(config),
    } as Record<Name, (keyof Conf)[]>;
    const nextGroups = { ...this.#groupRegistry, ...newGroup };

    return new SystemBuilder<
      PropReg & Conf,
      GroupReg & Record<Name, (keyof Conf)[]>,
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
    Conf extends Record<string, Prop> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(
    config: Conf
  ): SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend', Vocab> {
    for (const key of Object.keys(config)) {
      if (key in this.#groupRegistry) {
        throw new Error(
          `Prop name "${key}" collides with an existing group name. ` +
            `Group names and prop names must be disjoint.`
        );
      }
    }

    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
        const incoming = (config as Record<string, Prop>)[key];
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

    const mintInstance = (): SystemInstance<PropReg, GroupReg, Conds, Sels> => {
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
      }) as SystemInstance<PropReg, GroupReg, Conds, Sels>;

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
      styles: GlobalStyleMap,
      options?: { fontFaces?: readonly FontFace[] }
    ): GlobalStyleBlock => ({
      __brand: 'GlobalStyleBlock' as const,
      styles,
      ...(options?.fontFaces?.length
        ? { fontFaces: [...options.fontFaces] }
        : {}),
    })) as GlobalStylesFactory<PropReg>;

    const createKeyframes = ((frames: Record<string, KeyframeFrameMap>) =>
      keyframesImpl(frames)) as CreateKeyframesFactory<PropReg>;

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
        const incoming: VocabularyEntryInput[] = [];
        for (const [name, collection] of Object.entries(map)) {
          if (
            !collection ||
            (collection as { __brand?: unknown }).__brand !== 'Keyframes' ||
            typeof (collection as { __frames?: unknown }).__frames !== 'object'
          ) {
            throw new TypeError(
              `registerKeyframes: "${name}" is not a createKeyframes ` +
                'collection — register the factory return value itself.'
            );
          }
          incoming.push({
            kind: 'keyframes',
            name,
            frames: snapshotFrameData(
              (collection as { __frames: KeyframesFrameData }).__frames
            ),
          });
        }
        return registerEntries('registerKeyframes', incoming);
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
        const record: VocabularyRecord = Object.freeze({
          version: 1 as const,
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
        for (const member of ['registerKeyframes', 'registerGlobalStyles']) {
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
        registerKeyframes,
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
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
> = Animus<PropReg, GroupReg> & {
  toConfig(): SerializedConfig;
  /**
   * Frozen registry state captured at `build()` — what `extend()` merges
   * from. Optional only for systems built by an older @animus-ui/system.
   */
  getRegistrySnapshot?(): RegistrySnapshot;
} & RegistryBrand<Conds, Sels>;

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  /**
   * `{ transformName: sourceText }` — the only channel by which transforms
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
  propRegistry: Record<string, Prop>,
  groupRegistry: Record<string, readonly string[]>,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): RegistrySnapshot {
  const props: Record<string, Prop> = {};
  for (const [name, entry] of Object.entries(propRegistry)) {
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
  const transforms: Record<string, NamedTransform> = {};
  const transformOwners: Record<string, string> = {};

  for (const [propName, entry] of Object.entries(propRegistry)) {
    const s: SerializedPropEntry = { property: (entry as any).property };

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

    if ((entry as any).transform) {
      const fn = (entry as any).transform;
      const name = fn.transformName ?? fn.name;
      if (name) {
        const existing = transforms[name];
        if (existing && !areTransformsEqual(existing, fn)) {
          throw new Error(
            `Transform name "${name}" is registered by both props ` +
              `"${transformOwners[name]}" and "${propName}" with different ` +
              `function instances. Share one cached transform instance or ` +
              `give the transforms distinct names.`
          );
        }
        s.transform = name;
        transforms[name] = fn;
        transformOwners[name] = propName;
      }
    }

    if ((entry as any).currentVar) {
      s.currentVar = (entry as any).currentVar;
    }

    serialized[propName] = s;
  }

  const { selectors } = serializeSelectorMap(selectorRegistry);
  const conditions = serializeConditionMap(conditionRegistry);

  // Extraction evaluates transforms in a sandbox seeded only from source
  // text; without these a packaged transform silently falls back to raw values.
  const transformSources: Record<string, string> = {};
  for (const [name, fn] of Object.entries(transforms)) {
    const source = fn.transformSource;
    // Absent only on instances built by an older @animus-ui/system; skipping
    // leaves the raw-value fallback instead of the forwarder body.
    if (source !== undefined) transformSources[name] = source;
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
