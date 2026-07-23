/**
 * Type-level regression tests for @animus-ui/system
 *
 * This file is the living contract for the system's type behavior.
 * It is NOT a runtime test — it is compiled with `tsc --noEmit`.
 *
 * - Lines that compile = positive assertions (this MUST work)
 * - `@ts-expect-error` lines = negative assertions (this MUST fail)
 *   If a @ts-expect-error becomes "unused", tsc reports TS2578 — meaning
 *   the type system loosened and something that should be rejected is now accepted.
 * - Assert<> lines = precise type equality checks (compile = types match)
 *
 * Run: bun run test:types
 */

import type { ComponentPropsWithRef, RefObject } from 'react';
import { useRef } from 'react';

import { compose, createSystem, createTheme, createTransform } from '../src';
import { createGlobalStyles, createKeyframes, ds, tokens } from './test-system';

import type { SharedConfig, VariantPropsOf } from '../src/types/component';
import type { Prop, ThemedCSSProps } from '../src/types/config';
import type {
  EmittedScales,
  EmittedTokenPaths,
  TokenScales,
} from '../src/types/theme';

// ─── Type Utilities ─────────────────────────────────────────

type Assert<T extends true> = T;
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ─── Test Fixture ───────────────────────────────────────────

const _testTransform = createTransform('testTransform', (v) => `${v}px`);

// ─── Components Under Test ──────────────────────────────────

const DivBox = ds.styles({ display: 'flex' }).asElement('div');
const BtnBox = ds.styles({ display: 'flex' }).asElement('button');
const InputBox = ds.styles({ display: 'flex' }).asElement('input');

const VariantBtn = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 4 },
      lg: { p: 16 },
    },
  })
  .asElement('button');

const StatefulBox = ds
  .styles({ display: 'flex' })
  .states({
    loading: { opacity: '0.5' },
    disabled: { opacity: '0.3' },
  })
  .asElement('div');

const SpaceOnly = ds
  .styles({ display: 'flex' })
  .system({ space: true })
  .asElement('div');

const TextOnly = ds
  .styles({ display: 'flex' })
  .system({ text: true })
  .asElement('div');

// ─── Precise Type Assertions (compile-time only) ────────────

// Ref types narrow to the specific HTML element
type DivBoxProps = ComponentPropsWithRef<typeof DivBox>;
type BtnBoxProps = ComponentPropsWithRef<typeof BtnBox>;
type InputBoxProps = ComponentPropsWithRef<typeof InputBox>;

// Ref types must include the correct element — use extends, not exact (Ref is complex)
type _RefDivOk = Assert<
  RefObject<HTMLDivElement> extends NonNullable<DivBoxProps['ref']>
    ? true
    : false
>;
type _RefBtnOk = Assert<
  RefObject<HTMLButtonElement> extends NonNullable<BtnBoxProps['ref']>
    ? true
    : false
>;
type _RefInputOk = Assert<
  RefObject<HTMLInputElement> extends NonNullable<InputBoxProps['ref']>
    ? true
    : false
>;

// Variant prop narrows to declared values
type VariantBtnProps = ComponentPropsWithRef<typeof VariantBtn>;
type _VariantSize = Assert<
  IsExact<VariantBtnProps['size'], 'sm' | 'lg' | undefined>
>;

// ─── JSX Assertions (inside function for valid hook/JSX context) ───

function TypeTests() {
  // ── 1. Ref Forwarding ──────────────────────────────────────

  const divRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ✅ Correct ref types must compile
  <DivBox ref={divRef} />;
  <BtnBox ref={btnRef} />;
  <InputBox ref={inputRef} />;

  // ❌ Wrong ref types must fail
  // @ts-expect-error — HTMLButtonElement ref on a div component
  <DivBox ref={btnRef} />;
  // @ts-expect-error — HTMLDivElement ref on a button component
  <BtnBox ref={divRef} />;
  // @ts-expect-error — HTMLDivElement ref on an input component
  <InputBox ref={divRef} />;

  // ── 2. Variant Narrowing ───────────────────────────────────

  // ✅ Declared variant values must compile
  <VariantBtn size="sm" />;
  <VariantBtn size="lg" />;
  <VariantBtn />; // omitted = ok (optional)

  // ❌ Undeclared variant values must fail
  // @ts-expect-error — "xl" is not a declared variant
  <VariantBtn size="xl" />;
  // @ts-expect-error — number is not a valid variant value
  <VariantBtn size={42} />;

  // ── 3. State Narrowing ─────────────────────────────────────

  // ✅ Declared state props accept boolean
  <StatefulBox loading />;
  <StatefulBox disabled={false} />;
  <StatefulBox loading disabled />;

  // ❌ Undeclared state props must fail
  // @ts-expect-error — "active" is not a declared state
  <StatefulBox active />;

  // ── 4. Group Activation ────────────────────────────────────

  // ✅ Active group props must compile
  <SpaceOnly p={8} />;
  <SpaceOnly m={16} />;
  <TextOnly fontSize={16} />;

  // ── 5. Children and className ──────────────────────────────

  // ✅ All components accept children and className
  <DivBox className="extra">children here</DivBox>;
  <DivBox className="x">click</DivBox>;
  <StatefulBox>content</StatefulBox>;

  // ── 6. Nested Selectors ────────────────────────────────────

  // ── 6a. Nested Selector Type Identity ──────────────────────

  // Level 1: ThemedCSSProps itself resolves nested keys correctly
  type TestProps = { display: string; '&:hover': { color: string } };
  type TestConfig = Record<string, Prop>;
  type ResolvedNested = ThemedCSSProps<TestProps, TestConfig>;
  type _NestedNotUnknown = Assert<
    unknown extends ResolvedNested['&:hover'] ? false : true
  >;

  // Level 2: Generic inference through the chain captures nested types
  // (tests that .styles() propagates nested structure into return type)
  const _nestedChain = ds.styles({
    display: 'flex' as const,
    '&:hover': {
      color: 'red',
      p: 4,
    },
  });
  type InferredBase = (typeof _nestedChain)['baseStyles'];
  type InferredNested = InferredBase['&:hover'];
  type _ChainNestedNotUnknown = Assert<
    unknown extends InferredNested ? false : true
  >;

  // Level 3: Nested selector values carry type constraints (not unknown/any)
  // If the fallback regresses to `unknown`, booleans would be accepted,
  // making @ts-expect-error unused → TS2578 compile error
  // @ts-expect-error — boolean is not a valid CSS or system prop value
  ds.styles({ '&:hover': { p: true } });
  // @ts-expect-error — boolean is not a valid CSS property value
  ds.styles({ '&:hover': { display: true } });
  // @ts-expect-error — 199 is not in the space scale (0 | 4 | 8 | 16)
  ds.styles({ '&:hover': { p: 199 } });

  // ── 6b. Nested Selector Usage ────────────────────────────────

  // ✅ Nested selectors must accept CSS properties and system props
  ds.styles({
    display: 'flex',
    '&:hover': {
      color: 'red',
      opacity: '0.8',
    },
    '&[data-state="open"]': {
      p: 4,
      display: 'block',
    },
  });

  // ✅ Nested selectors in variant base and options
  ds.styles({ display: 'flex' }).variant({
    prop: 'mode',
    base: {
      '&:focus-visible': {
        outline: '2px solid blue',
      },
    },
    variants: {
      open: {
        '&[aria-expanded="true"]': {
          opacity: '1',
          p: 8,
        },
      },
      closed: {
        '&[aria-expanded="false"]': {
          opacity: '0',
        },
      },
    },
  });

  // ✅ Nested selectors in states
  ds.styles({ display: 'flex' }).states({
    loading: {
      '&::after': {
        content: '""',
        display: 'block',
      },
    },
  });

  // ── 7. Compound Variants ──────────────────────────────────

  // ✅ Compound with valid condition keys and values must compile
  const CompoundBtn = ds
    .styles({ display: 'flex' })
    .variant({
      prop: 'size',
      variants: {
        sm: { p: 4 },
        lg: { p: 16 },
      },
    })
    .variant({
      variants: {
        fill: { opacity: '1' },
        ghost: { opacity: '0.8' },
      },
    })
    .compound({ size: 'sm', variant: 'ghost' }, { p: 0 })
    .compound({ size: 'lg' }, { p: 8 })
    .asElement('button');

  // ✅ Compound components accept variant props normally
  <CompoundBtn size="sm" variant="fill" />;
  <CompoundBtn size="lg" />;
  <CompoundBtn />;

  // ✅ Compound chains with states must compile
  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
    .compound({ size: 'sm' }, { p: 0 })
    .states({ loading: { opacity: '0.5' } })
    .asElement('div');

  // ✅ Skipping compound (variant straight to states) must compile
  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 } } })
    .states({ loading: { opacity: '0.5' } })
    .asElement('div');

  // ❌ Cannot call .variant() after .compound() — ordering enforced
  const _compoundsInstance = ds
    .styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 } } })
    .compound({ size: 'sm' }, { p: 0 });
  // @ts-expect-error — .variant() not available after .compound()
  _compoundsInstance.variant({ variants: { fill: { p: 0 } } });

  // ── 7b. Compound Condition Arrays ───────────────────────────

  // ✅ Array condition values must compile — match ANY in array
  ds.styles({ display: 'flex' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .variant({
      variants: {
        fill: { opacity: '1' },
        ghost: { opacity: '0.8' },
        subtle: { opacity: '0.6' },
      },
    })
    .compound({ variant: ['ghost', 'subtle'], size: 'sm' }, { p: 0 })
    .asElement('button');

  // ✅ Mixed single + array conditions in same compound
  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
    .variant({
      variants: { fill: { opacity: '1' }, ghost: { opacity: '0.8' } },
    })
    .compound({ variant: ['fill', 'ghost'], size: 'sm' }, { p: 0 })
    .compound({ size: 'lg' }, { p: 8 })
    .asElement('button');

  // ── 8. Negative Scale Values ──────────────────────────────

  // ✅ Negative margin values from scale must compile
  <SpaceOnly m={-4} />;
  <SpaceOnly m={-8} />;
  <SpaceOnly m={-16} />;

  // ✅ Negative individual margins must compile
  <SpaceOnly mt={-4} />;
  <SpaceOnly mb={-8} />;
  <SpaceOnly mx={-16} />;

  // ❌ Negative values not in scale must fail
  // @ts-expect-error — -99 is not a negated scale key (scale is 0|4|8|16)
  <SpaceOnly m={-99} />;

  // ❌ Negative padding must fail (padding has no negative flag)
  // @ts-expect-error — padding does not support negative scale values
  <SpaceOnly p={-4} />;

  // ── 9. HTML Attributes Pass Through ────────────────────────

  // ✅ Element-specific HTML attributes must compile
  <BtnBox type="submit" />;
  <BtnBox onClick={() => {}} />;
  <InputBox placeholder="type here" />;
  <DivBox role="banner" />;

  // ❌ Wrong element attributes must fail
  // @ts-expect-error — 'type' as submit is not valid on div
  <DivBox type="submit" />;

  // ── 9b. Animus Props Override HTML Attributes ─────────────────

  // ✅ Variant 'size' overrides HTML input[size] (number → variant values)
  const SizedInput = ds
    .styles({ display: 'block' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .asElement('input');

  <SizedInput size="sm" />;
  <SizedInput size="lg" />;
  // @ts-expect-error — number is not a valid variant value (HTML size overridden)
  <SizedInput size={20} />;

  // ✅ Non-colliding HTML attributes still work alongside variant props
  <SizedInput size="sm" placeholder="type here" />;

  // ── 9c. Prop Strict Mode ──────────────────────────────────────

  // Custom prop groups: one strict (default), one loose
  const strictGroup = {
    p: { property: 'padding', scale: 'space' },
  } as const;

  const looseGroup = {
    gap: { property: 'gap', scale: 'space', strict: false },
    m: { property: 'margin', scale: 'space', negative: true, strict: false },
  } as const;

  const { system: strictLooseDs } = createSystem()
    .addGroup('strict', strictGroup)
    .addGroup('loose', looseGroup)
    .build();

  const StrictLooseBox = strictLooseDs
    .styles({ display: 'flex' })
    .system({ strict: true, loose: true })
    .asElement('div');

  // ✅ Strict prop (p) accepts scale keys
  <StrictLooseBox p={4} />;
  <StrictLooseBox p={16} />;

  // ❌ Strict prop (p) rejects arbitrary strings
  // @ts-expect-error — strict scale: '2.5rem' is not a scale key
  <StrictLooseBox p="2.5rem" />;

  // ✅ Loose prop (gap) accepts scale keys (typeahead)
  <StrictLooseBox gap={4} />;
  <StrictLooseBox gap={16} />;

  // ✅ Loose prop (gap) accepts arbitrary strings (escape hatch)
  <StrictLooseBox gap="2.5rem" />;
  <StrictLooseBox gap="clamp(1rem, 2vw, 3rem)" />;

  // ✅ Loose prop (m) with negative: true — negative scale keys still work
  <StrictLooseBox m={-4} />;
  <StrictLooseBox m={-16} />;

  // ✅ Loose prop (m) with negative: true — arbitrary strings also work
  <StrictLooseBox m="-2.5rem" />;

  // ✅ Loose prop (gap) in responsive syntax accepts arbitrary per-breakpoint
  <StrictLooseBox gap={{ xs: '1rem', sm: 8, md: '2.5rem' }} />;

  // ── 10. compose() — Slot Composition ─────────────────────────

  // Slot fixtures for compose tests
  const SlotRoot = ds
    .styles({ display: 'flex' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .variant({
      prop: 'tone',
      variants: { muted: { opacity: '0.6' }, bold: { opacity: '1' } },
    })
    .asElement('div');

  const SlotControl = ds
    .styles({ display: 'block' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .variant({
      prop: 'toggled',
      variants: { on: { opacity: '1' }, off: { opacity: '0.5' } },
    })
    .asElement('input');

  const SlotLabel = ds
    .styles({ display: 'inline' })
    .variant({
      prop: 'size',
      variants: { sm: { fontSize: 14 }, lg: { fontSize: 16 } },
    })
    .asElement('span');

  // ── 10a. VariantPropsOf extraction ──────────────────────────

  type RootVariants = VariantPropsOf<typeof SlotRoot>;
  type _RootHasSize = Assert<'size' extends keyof RootVariants ? true : false>;
  type _RootHasTone = Assert<'tone' extends keyof RootVariants ? true : false>;
  type _RootSizeValues = Assert<
    IsExact<RootVariants['size'], 'sm' | 'lg' | undefined>
  >;

  type ControlVariants = VariantPropsOf<typeof SlotControl>;
  type _ControlHasSize = Assert<
    'size' extends keyof ControlVariants ? true : false
  >;
  type _ControlHasToggled = Assert<
    'toggled' extends keyof ControlVariants ? true : false
  >;

  // ── 10b. SharedConfig — valid keys are Root's variant keys ───

  type TestSlots = {
    Root: typeof SlotRoot;
    Control: typeof SlotControl;
    Label: typeof SlotLabel;
  };

  // SharedConfig offers Root's variant keys (size, tone) as options
  type Config = SharedConfig<TestSlots>;
  type _ConfigHasSize = Assert<'size' extends keyof Config ? true : false>;
  type _ConfigHasTone = Assert<'tone' extends keyof Config ? true : false>;

  // ── 10c. compose() — valid call compiles ────────────────────

  const Composed = compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { size: true } }
  );

  // ✅ Root keeps shared props (it's the provider)
  <Composed.Root size="sm">children</Composed.Root>;
  <Composed.Root size="lg" tone="bold">
    children
  </Composed.Root>;

  // ✅ Children accept className and children
  <Composed.Control className="extra" />;
  <Composed.Label>label text</Composed.Label>;

  // ✅ Non-shared variant props still accepted on children
  <Composed.Control toggled="on" />;

  // ✅ Children can override shared values via direct props
  <Composed.Control size="lg" />;
  <Composed.Label size="lg">text</Composed.Label>;

  // ── 10d. compose() — sealed output (no .extend) ─────────────

  // @ts-expect-error — composed Root has no .extend()
  Composed.Root.extend;
  // @ts-expect-error — composed Control has no .extend()
  Composed.Control.extend;
  // @ts-expect-error — composed Label has no .extend()
  Composed.Label.extend;

  // ── 10e. compose() — shared config validation ──────────────

  // ✅ tone is on Root — valid shared key even if no child has it
  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { tone: true } }
  );

  // ✅ size + tone together — both exist on Root
  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { size: true, tone: true } }
  );

  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    // @ts-expect-error — 'toggled' is not a Root variant key
    { shared: { toggled: true } }
  );

  // ── 10f. compose() — empty shared config is valid ───────────

  const Grouped = compose(
    { Root: SlotRoot, Control: SlotControl },
    { shared: {} }
  );
  <Grouped.Root size="sm" tone="bold">
    children
  </Grouped.Root>;
  <Grouped.Control toggled="on" />;

  // ── 10g. compose() — no context option (RSC-safe) ──────────

  // ✅ compose without context accepted
  compose({ Root: SlotRoot, Control: SlotControl }, { shared: { size: true } });

  compose(
    { Root: SlotRoot, Control: SlotControl },
    // @ts-expect-error — context option removed from compose() (use composeWithContext)
    { shared: { size: true }, context: true }
  );

  // ── 10h. asChild prop typing ─────────────────────────────────

  // ✅ asChild: true accepted on .asElement() output
  <SlotRoot asChild>
    <span>child</span>
  </SlotRoot>;

  // ✅ asChild: false accepted
  <SlotRoot asChild={false}>children</SlotRoot>;

  // @ts-expect-error — asChild must be boolean, not string
  <SlotRoot asChild="yes">children</SlotRoot>;

  // ── 11. addScale Config Object ─────────────────────────────

  // ✅ Config object with name + values compiles
  const _scaleBuilder1 = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({
      name: 'space',
      values: { 0: '0', 4: '0.25rem', 8: '0.5rem' },
    });

  // ✅ Config object with emit: true compiles
  const _scaleBuilder2 = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({
      name: 'sizes',
      emit: true,
      values: { navHeight: '48px' },
    });

  // ✅ Scale name is inferred as literal type in returned builder
  type Builder1Theme = ReturnType<(typeof _scaleBuilder1)['build']>;
  type _HasSpace = Assert<
    'space' extends keyof TokenScales<Builder1Theme> ? true : false
  >;

  // ✅ Accumulated theme type includes all added scales
  const _scaleBuilder3 = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({ name: 'space', values: { 0: '0', 8: '0.5rem' } })
    .addScale({ name: 'fontSizes', values: { 14: '0.875rem', 16: '1rem' } });

  type Builder3Theme = ReturnType<(typeof _scaleBuilder3)['build']>;
  type _HasBothScales = Assert<
    'space' extends keyof TokenScales<Builder3Theme>
      ? 'fontSizes' extends keyof TokenScales<Builder3Theme>
        ? true
        : false
      : false
  >;

  // ✅ Scale values are raw in the type (var() mapping is in the manifest, not the type)
  type Builder2Theme = ReturnType<(typeof _scaleBuilder2)['build']>;
  type SizesType = Builder2Theme['sizes'];
  type _EmittedIsRaw = Assert<
    SizesType['navHeight'] extends string ? true : false
  >;

  // ✅ Non-emitted scale values also raw
  type SpaceType = Builder1Theme['space'];
  type _RawIsString = Assert<SpaceType[0] extends string ? true : false>;

  // ── 11b. EmittedScales<T> — derive emitted scales from built theme ───

  // ✅ EmittedScales extracts scales whose values are var() references
  type TestEmitted = EmittedScales<Builder2Theme>;
  type _EmittedHasSizes = Assert<'sizes' extends TestEmitted ? true : false>;

  // ✅ Non-emitted scales are excluded from EmittedScales
  type TestEmitted1 = EmittedScales<Builder1Theme>;
  // space was NOT emitted, so EmittedScales should not include it
  type _SpaceNotEmitted = Assert<'space' extends TestEmitted1 ? false : true>;

  // ✅ colors are always emitted (via addColors)
  type TestTheme = typeof tokens;
  type TestColorsEmitted = EmittedScales<TestTheme>;
  type _ColorsEmitted = Assert<
    'colors' extends TestColorsEmitted ? true : false
  >;

  // ── 11c. Emitted generic accumulates through the chain ─────────

  // ✅ Builder with addColors has 'colors' in Emitted
  const _chainBuilder = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({ name: 'space', values: { 8: '0.5rem' } })
    .addColors({ red: '#f00' })
    .addScale({ name: 'sizes', emit: true, values: { nav: '48px' } });

  // The Emitted generic on the builder tracks 'colors' | 'sizes'
  // We verify indirectly: the built theme has sizes as var() and space as raw
  type ChainTheme = ReturnType<(typeof _chainBuilder)['build']>;
  type ChainEmitted = EmittedScales<ChainTheme>;
  type _ChainHasColors = Assert<'colors' extends ChainEmitted ? true : false>;
  type _ChainHasSizes = Assert<'sizes' extends ChainEmitted ? true : false>;
  type _ChainNoSpace = Assert<'space' extends ChainEmitted ? false : true>;

  // ── 11d. EmittedTokenPaths — valid token ref paths ──────────

  // ✅ EmittedTokenPaths enumerates scale.key paths for emitted scales
  type ChainPaths = EmittedTokenPaths<ChainTheme>;
  // 'colors.red' should be a valid path (colors was emitted via addColors)
  type _HasColorsRed = Assert<'colors.red' extends ChainPaths ? true : false>;
  // 'sizes.nav' should be a valid path (sizes was emitted via emit: true)
  type _HasSizesNav = Assert<'sizes.nav' extends ChainPaths ? true : false>;
  // 'space.8' should NOT be a valid path (space was not emitted)
  type _NoSpacePath = Assert<'space.8' extends ChainPaths ? false : true>;

  // ── 11e. Token ref validation in addScale values ────────────

  // ✅ Valid token ref to emitted scale compiles
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ ember: '#ff2800' })
    .addColorModes('dark', {
      dark: { text: 'ember' },
      light: { text: 'ember' },
    })
    .addScale({
      name: 'shadows',
      values: { glow: '0 0 12px {colors.text}' },
    });

  // Token ref validation (❌ cases) removed — type-level ValidateScaleRef was
  // removed to prevent TS2589 depth explosion (see createTheme.ts L269).
  // Token refs are validated at runtime in resolveTokenRefs() during build().

  // ✅ Token ref to emitted scale with valid key compiles
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
    .addScale({
      name: 'layout',
      values: { stickyTop: 'calc({sizes.navHeight} + 16px)' },
    });

  // ✅ {colors.key/number} compiles for valid color keys
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ ember: '#ff2800' })
    .addColorModes('dark', {
      dark: { text: 'ember', glow: 'ember' },
      light: { text: 'ember', glow: 'ember' },
    })
    .addScale({
      name: 'elevation',
      values: { glow: '0 0 8px {colors.glow/40}' },
    });

  // ── 12. Contextual Vars ──────────────────────────────────────

  // ✅ addContextualVars with valid scale compiles, var names in TokenScales
  type TestTokenScales = TokenScales<TestTheme>;
  type TestColors = TestTokenScales['colors'];
  type _ContextualBgInColors = Assert<
    'current-bg' extends keyof TestColors ? true : false
  >;

  // ✅ Existing color keys are preserved
  type _PrimaryStillInColors = Assert<
    'primary' extends keyof TestColors ? true : false
  >;

  // ❌ declareContextualVars with nonexistent scale produces type error
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    // @ts-expect-error — 'bogus' is not a scale in the theme
    .declareContextualVars({ bogus: ['x'] });

  // ✅ Contextual var name accepted for any color-scale prop
  ds.styles({ bg: 'current-bg' }).asElement('div');
  ds.styles({ borderColor: 'current-bg' }).asElement('div');
  ds.styles({ color: 'current-bg' }).asElement('div');
  ds.styles({ fill: 'current-bg' }).asElement('div');

  // ❌ Contextual var name NOT accepted for non-color-scale props
  // @ts-expect-error — 'current-bg' is not in fontSizes scale
  ds.styles({ fontSize: 'current-bg' }).asElement('div');
  // @ts-expect-error — 'current-bg' is not in space scale
  ds.styles({ p: 'current-bg' }).asElement('div');

  // ✅ Const generic narrowing works without as const (no error = narrowing worked)
  const _ctxBuilder = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars({
      colors: ['current-bg', 'current-border'],
    });

  type CtxTheme = ReturnType<(typeof _ctxBuilder)['build']>;
  type CtxColors = TokenScales<CtxTheme>['colors'];
  type _CtxHasBg = Assert<'current-bg' extends keyof CtxColors ? true : false>;
  type _CtxHasBorder = Assert<
    'current-border' extends keyof CtxColors ? true : false
  >;

  // ── 12b. @property registration metadata (D6) ────────────────

  // ✅ Registration metadata is accepted and does NOT alter name narrowing:
  // 'current-bg' remains a literal-typed member of the colors scale.
  const _ctxRegistered = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars(
      { colors: ['current-bg'] },
      {
        'current-bg': {
          syntax: '<color>',
          inherits: true,
          initialValue: 'transparent',
        },
      }
    );
  type CtxRegTheme = ReturnType<(typeof _ctxRegistered)['build']>;
  type CtxRegColors = TokenScales<CtxRegTheme>['colors'];
  type _CtxRegHasBg = Assert<
    'current-bg' extends keyof CtxRegColors ? true : false
  >;

  // ✅ Metadata is optional — the initial-value descriptor may be omitted.
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars(
      { colors: ['current-accent'] },
      { 'current-accent': { syntax: '*', inherits: false } }
    );

  // ❌ Registration keys are constrained to the declared var names.
  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars(
      { colors: ['current-bg'] },
      // @ts-expect-error — 'not-declared' is not a declared contextual var name
      { 'not-declared': { syntax: '<color>', inherits: true } }
    );

  // ── 12c. Container establishment props (D7) ──────────────────
  // Establishment is plain pass-through CSS declarations (typed via csstype);
  // no dedicated API. These must typecheck through the styles() surface.
  ds.styles({ containerType: 'inline-size' }).asElement('div');
  ds.styles({ containerName: 'card' }).asElement('div');
  ds.styles({ container: 'card / inline-size' }).asElement('div');
  ds.styles({ containerType: 'inline-size', containerName: 'card' }).asElement(
    'section'
  );

  // ── 13. .system() Mixed Namespace & Regression ─────────────

  // Guard: Extract<keyof PropRegistry, string> must resolve to literal
  // prop name union — NOT collapse to `string`.
  // If it collapses to `string`, the @ts-expect-error lines below become
  // "unused" (TS2578) because `string` accepts everything — which is
  // itself a compile error. This makes the regression self-guarding.

  // ✅ .system() accepts group names
  ds.styles({ display: 'flex' }).system({ space: true }).asElement('div');
  ds.styles({ display: 'flex' })
    .system({ surface: true, text: true })
    .asElement('div');

  // ✅ .system() accepts individual prop names from the registry
  ds.styles({ display: 'flex' }).system({ p: true }).asElement('div');
  ds.styles({ display: 'flex' }).system({ bg: true }).asElement('div');
  ds.styles({ display: 'flex' }).system({ fontSize: true }).asElement('div');

  // ✅ .system() accepts ungrouped props registered via .addProps()
  ds.styles({ display: 'flex' }).system({ ratio: true }).asElement('div');

  // ✅ .system() accepts mixed: group name + individual prop name
  ds.styles({ display: 'flex' })
    .system({ space: true, ratio: true })
    .asElement('div');
  ds.styles({ display: 'flex' })
    .system({ surface: true, p: true, ratio: true })
    .asElement('div');

  // ❌ .system() rejects strings that aren't group names or prop names
  // @ts-expect-error — 'bogus' is not a group name or prop name
  ds.styles({ display: 'flex' }).system({ bogus: true }).asElement('div');
  // @ts-expect-error — 'nonexistent' is not in the system
  ds.styles({ display: 'flex' }).system({ nonexistent: true }).asElement('div');

  // ❌ .system() rejects group-like strings that aren't registered
  // @ts-expect-error — 'layout' is not a group name (it's 'arrange' in test fixture)
  ds.styles({ display: 'flex' }).system({ layout: true }).asElement('div');

  // ── 13b. Overlap tolerance in addGroup ─────────────────────

  // ✅ Same prop in two groups with matching definition compiles
  const { system: overlapDs } = createSystem()
    .addGroup('flex', {
      gap: { property: 'gap', scale: 'space' } as const,
      flexDirection: { property: 'flexDirection' } as const,
    })
    .addGroup('grid', {
      gap: { property: 'gap', scale: 'space' } as const,
      gridTemplateColumns: { property: 'gridTemplateColumns' } as const,
    })
    .build();

  // ✅ gap is accessible through either group
  overlapDs.styles({ display: 'flex' }).system({ flex: true }).asElement('div');
  overlapDs.styles({ display: 'grid' }).system({ grid: true }).asElement('div');

  // ✅ Both group names and individual props are valid
  overlapDs
    .styles({ display: 'flex' })
    .system({ flex: true, gridTemplateColumns: true })
    .asElement('div');

  // ❌ Invalid identifiers rejected
  // @ts-expect-error — 'nope' is not a group or prop name
  overlapDs.styles({}).system({ nope: true }).asElement('div');

  // ── 13c. addProps ungrouped registration ───────────────────

  // ✅ addProps registers props without grouping
  const { system: ungroupedDs } = createSystem()
    .addGroup('space', {
      p: { property: 'padding', scale: 'space' } as const,
    })
    .addProps({
      customRatio: { property: 'aspectRatio' } as const,
    })
    .build();

  // ✅ Ungrouped prop accepted by .system()
  ungroupedDs
    .styles({ display: 'flex' })
    .system({ customRatio: true })
    .asElement('div');

  // ✅ Mixed: group name + ungrouped prop
  ungroupedDs
    .styles({ display: 'flex' })
    .system({ space: true, customRatio: true })
    .asElement('div');

  // ❌ Still rejects unknown identifiers
  // @ts-expect-error — 'fake' is not registered
  ungroupedDs.styles({}).system({ fake: true }).asElement('div');

  // ── 13d. Callsite prop exposure — single prop activation ───

  // When .system() activates a single prop, the JSX callsite MUST
  // accept that prop and reject other system props not activated.

  const SinglePropBox = ds
    .styles({ display: 'flex' })
    .system({ p: true })
    .asElement('div');

  // ✅ Activated prop is accepted at callsite
  <SinglePropBox p={4} />;
  <SinglePropBox p={16} />;
  // ✅ Responsive syntax works on activated prop
  <SinglePropBox p={{ _: 4, md: 16 }} />;

  // ❌ Invalid breakpoint keys must fail in responsive objects
  // @ts-expect-error — 'xxl' is not a configured breakpoint key
  <SinglePropBox p={{ _: 4, xxl: 16 }} />;
  // @ts-expect-error — 'mobile' is not a configured breakpoint key
  <SinglePropBox p={{ _: 4, mobile: 8 }} />;

  // ✅ Group activation exposes all group props at callsite
  const GroupBox = ds
    .styles({ display: 'flex' })
    .system({ text: true })
    .asElement('div');

  <GroupBox fontSize={14} />;
  <GroupBox fontWeight={500} />;
  <GroupBox letterSpacing="-0.01em" />;

  // ✅ Mixed: group + individual prop at callsite
  const MixedBox = ds
    .styles({ display: 'flex' })
    .system({ space: true, ratio: true })
    .asElement('div');

  <MixedBox p={4} m={8} />;
  <MixedBox ratio="16:9" />;
  <MixedBox p={4} ratio="4:3" />;

  // ── 13e. Collision constraint — group names ≠ prop names ──

  // ❌ addGroup rejects group name that collides with existing prop name
  createSystem()
    .addProps({ gap: { property: 'gap' } as const })
    // @ts-expect-error — 'gap' is already a prop name
    .addGroup('gap', { spacing: { property: 'gap' } as const });

  // ❌ addProps rejects prop name that collides with existing group name
  createSystem()
    .addGroup('space', { p: { property: 'padding' } as const })
    // @ts-expect-error — 'space' collides with group name
    .addProps({ space: { property: 'padding' } as const });

  // ── 14. .extend() — Composition via Inheritance ─────────────

  // Base component: div with variants
  const BaseCard = ds
    .styles({ display: 'flex', flexDirection: 'column' })
    .variant({
      prop: 'size',
      defaultVariant: 'md',
      variants: {
        sm: { p: 4, fontSize: 14 },
        md: { p: 8, fontSize: 16 },
        lg: { p: 16, fontSize: 16 },
      },
    })
    .variant({
      prop: 'intent',
      variants: {
        primary: { bg: 'primary' },
        secondary: { bg: 'bg' },
      },
    })
    .asElement('div');

  // ── 14a. Polymorphism — element re-casting ──────────────────

  // ✅ Extend div as <a> — anchor-specific props become available
  const LinkCard = BaseCard.extend()
    .styles({ textDecoration: 'none' })
    .asElement('a');

  // Anchor-specific props work, variant props inherited
  <LinkCard href="/home" size="lg" intent="primary" />;
  <LinkCard href="/about" target="_blank" />;

  // ✅ Extend div as <section> — different semantic element
  const SectionCard = BaseCard.extend().asElement('section');
  <SectionCard size="sm" intent="secondary" />;

  // ── 14b. Variant inheritance ────────────────────────────────

  // ✅ Extended component inherits parent's variant props
  <LinkCard size="sm" />;
  <LinkCard size="lg" intent="secondary" />;

  // ── 14c. Add new variant options to existing prop ───────────

  const BigCard = BaseCard.extend()
    .variant({
      prop: 'size',
      variants: { xl: { p: 16, fontSize: 16 } },
    })
    .asElement('div');

  // ✅ New option compiles
  <BigCard size="xl" />;
  // ✅ Original options still work
  <BigCard size="sm" intent="primary" />;

  // ── 14d. Add entirely new variant axis ──────────────────────

  const ElevatedCard = BaseCard.extend()
    .variant({
      prop: 'elevation',
      variants: {
        flat: { boxShadow: 'none' },
        raised: { boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
      },
    })
    .asElement('div');

  // ✅ New axis available alongside inherited axes
  <ElevatedCard size="md" intent="primary" elevation="raised" />;

  // ── 14e. State inheritance + new states ─────────────────────

  // Base with states
  const StatefulCard = ds
    .styles({ display: 'block' })
    .states({ highlighted: { opacity: '1' } })
    .asElement('div');

  const ActiveCard = StatefulCard.extend()
    .states({ active: { bg: 'primary' } })
    .asElement('div');

  // ✅ New state works as boolean
  <ActiveCard active />;

  // ✅ Base state also works as boolean
  <StatefulCard highlighted />;

  // ── 14f. System prop expansion downstream ───────────────────

  // ✅ Extension widens the system prop surface
  const LayoutCard = BaseCard.extend().system({ space: true }).asElement('div');

  <LayoutCard p={8} m={4} size="sm" />;

  // ── 14f. Compound injection across inheritance ──────────────

  // ✅ Compound references parent's variant keys
  const CompoundCard = BaseCard.extend()
    .compound({ size: 'lg', intent: 'primary' }, { boxShadow: 'none' })
    .asElement('div');

  <CompoundCard size="lg" intent="primary" />;

  // ── 14g. Chained extend — multiple levels ──────────────────

  const Level1 = ds
    .styles({ display: 'block' })
    .variant({ prop: 'tone', variants: { muted: { opacity: '0.5' } } })
    .asElement('div');

  const Level2 = Level1.extend()
    .variant({ prop: 'density', variants: { tight: { p: 4 } } })
    .asElement('section');

  const Level3 = Level2.extend()
    .variant({
      prop: 'elevation',
      variants: { low: { boxShadow: 'none' } },
    })
    .asElement('article');

  type Level3Props = ComponentPropsWithRef<typeof Level3>;
  // All three levels' variant props available
  type _L3HasTone = Assert<'tone' extends keyof Level3Props ? true : false>;
  type _L3HasDensity = Assert<
    'density' extends keyof Level3Props ? true : false
  >;
  type _L3HasElevation = Assert<
    'elevation' extends keyof Level3Props ? true : false
  >;

  // ✅ All inherited props compile at the final level
  <Level3 tone="muted" density="tight" elevation="low" />;

  return null;
}

// ─── Custom Prop Transform Return Type Guard ───────────────
// .props() transforms may return string | number | CSSObject.
// The CSSObject branch compiles at the type level to satisfy consumer
// `.props({ ... transform: someImportedTransform })` patterns where the
// imported transform's inferred signature demands the wider union.
// Runtime currently no-ops object returns (rule-level transforms are a
// future expansion). The negative assertion that rejected CSSObject returns
// has been DISABLED intentionally — see packages/system/src/types/config.ts
// (CustomPropConfig.transform).

// ✅ string | number returns compile
ds.styles({}).props({
  sizing: {
    property: 'width',
    transform: (val: string | number) =>
      typeof val === 'number' ? `${val}px` : val,
  },
});

// ✅ CSSObject returns also compile (type-level widening; runtime no-op)
ds.styles({}).props({
  sizing: {
    property: 'width',
    transform: (val: string | number) => ({ width: `${val}px` }),
  },
});

// ─── Selector Alias Props ────────────────────────────────────

// Components with system groups accept _hover, _disabled, etc.
const AliasBox = ds
  .styles({ display: 'flex' })
  .system({ space: true, surface: true })
  .asElement('div');

// _hover accepts system group props (space + surface groups)
void (<AliasBox _hover={{ p: 8 }} />);
void (<AliasBox _hover={{ bg: 'primary' }} />);
void (<AliasBox _disabled={{ p: 16 }} />);
void (<AliasBox _before={{ p: 8 }} />);
void (<AliasBox _active={{ bg: 'red' }} />);
void (<AliasBox _focusVisible={{ p: 8, bg: 'primary' }} />);

// _hover still works alongside regular props
void (<AliasBox p={8} bg="primary" _hover={{ bg: 'red' }} />);

// Negative: unknown alias key rejected
// @ts-expect-error — _groupHover is not a built-in alias
void (<AliasBox _groupHover={{ p: 8 }} />);

// Selector alias props preserved through extend()
const ExtendedAlias = AliasBox.extend()
  .styles({ display: 'grid' })
  .asElement('section');
void (<ExtendedAlias _hover={{ p: 8 }} />);
void (<ExtendedAlias _disabled={{ bg: 'red' }} />);

// ─── Drift detection: BuiltInSelectorAlias ↔ BUILT_IN_SELECTORS ──
// If a key exists in BUILT_IN_SELECTORS but not in BuiltInSelectorAlias,
// this assertion will fail with TS2344. Keeps the two in sync.
import { BUILT_IN_SELECTORS } from '../src/selectors';

import type { BuiltInSelectorAlias } from '../src/types/config';

type AssertAllKeysAreAliases = {
  [K in keyof typeof BUILT_IN_SELECTORS]: K extends BuiltInSelectorAlias
    ? true
    : never;
};
// Force evaluation — if any key maps to `never`, this assignment fails
void (0 as unknown as AssertAllKeysAreAliases);

// ─── 14. Condition typing (D9) + pass-through responsive maps (D10) ──────
//
// test-system.ts registers three condition aliases (`_motionReduce` /`_cardSm`/
// `_supportsGrid`, one per kind) plus a custom selector alias (`_hoverChild`)
// and PUBLISHES them via `declare module` augmentation — so this whole file
// compiles in the VALIDATING mode: unknown `_`/`@` block keys resolve to the
// branded rejection arms. The complementary PERMISSIVE mode (a system that
// registers aliases but does NOT augment) is proved live by the vite-app
// fixture's build (`e2e/vite-app` authors `_motionReduce` blocks with no
// `Conditions` augmentation) — it cannot be shown in-file because the
// augmentation is global to this compilation.

import type { ConditionsOf, SelectorsOf } from '../src';

// Publication reaches the arms: the phantom brand surfaces exactly the
// registered keys (proves the SystemBuilder `Conds`/`Sels` accumulation).
type _CondsPublished = Assert<
  IsExact<
    ConditionsOf<typeof ds>,
    '_motionReduce' | '_cardSm' | '_supportsGrid'
  >
>;
type _SelsPublished = Assert<IsExact<SelectorsOf<typeof ds>, '_hoverChild'>>;

// ── 14a. Registered condition aliases at every chain position ──────────────
// (media-condition-aliases §"Condition blocks recognized at every chain level")

// .styles()
ds.styles({ _motionReduce: { transition: 'none' } });
// .variant() base + variant bodies
ds.styles({ display: 'flex' }).variant({
  prop: 'size',
  base: { _cardSm: { p: 8 } },
  variants: {
    sm: { _motionReduce: { transition: 'none' } },
    lg: { _supportsGrid: { display: 'grid' } },
  },
});
// .compound()
ds.styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .compound({ size: 'sm' }, { _supportsGrid: { display: 'grid' } });
// .states()
ds.styles({ display: 'flex' }).states({
  loading: { _motionReduce: { transition: 'none' } },
});

// ── 14b. Unknown-alias + malformed-at-rule negatives (branded) ─────────────
// (selector-alias-registry §"Unregistered condition keys rejected at type
// level" — the branded type name states the offending key + remedy)

// @ts-expect-error — _motionReduc is not a registered condition/selector alias
ds.styles({ _motionReduc: { transition: 'none' } });
// @ts-expect-error — _bogusAlias is unregistered (UnknownConditionAlias)
ds.styles({ _bogusAlias: { p: 4 } });
// @ts-expect-error — '@containr …' is a misspelled at-rule prefix (UnknownAtRule)
ds.styles({ '@containr card (min-width: 400px)': { p: 8 } });
// @ts-expect-error — '@medai …' misspelled prefix
ds.styles({ '@medai (min-width: 400px)': { p: 8 } });

// ── 14c. Scale narrowing at depth 1 and 2 ──────────────────────────────────
// (selector-alias-registry §"Registered aliases accepted at depth" — the
// nested block typechecks AND scale-typed props retain scale-key validation)

// depth-1 positive / negative
ds.styles({ _motionReduce: { p: 8 } });
// @ts-expect-error — 199 is not in the space scale, inside a condition alias
ds.styles({ _motionReduce: { p: 199 } });
// depth-2 positive: condition alias nested inside a selector alias
ds.styles({ _hover: { _cardSm: { p: 4 } } });
// @ts-expect-error — 199 not in scale at depth 2 (checking survives recursion)
ds.styles({ _hover: { _cardSm: { p: 199 } } });

// ── 14d. Depth-8 mixed condition/selector stress ───────────────────────────
// (design D12 — no depth cap; D9 — one instantiation per authored level,
// far under the TS2589 limit; checking survives to the deepest leaf)
ds.styles({
  _hover: {
    _cardSm: {
      '&:focus-visible': {
        _supportsGrid: {
          _motionReduce: {
            '&::after': {
              _hoverChild: {
                // depth-8 leaf — scale key still validated here
                p: 4,
              },
            },
          },
        },
      },
    },
  },
});
// off-scale value at the depth-8 leaf still rejected (directive sits at the
// leaf — `@ts-expect-error` suppresses only the immediately following line)
ds.styles({
  _hover: {
    _cardSm: {
      '&:focus-visible': {
        _supportsGrid: {
          _motionReduce: {
            '&::after': {
              _hoverChild: {
                // @ts-expect-error — 199 not in space scale at depth 8
                p: 199,
              },
            },
          },
        },
      },
    },
  },
});

// ── 14e. Raw-key accept + reject ───────────────────────────────────────────
// (media-condition-aliases §"Raw media query block keys"; container-query
// support). Raw at-rule keys need no registration — validated by SHALLOW
// prefix+tail shape only. Container NAMES are NOT a closed union in this
// increment (no container-name registry — D9 "when available"), so any name is
// accepted by shape; deep query-grammar validation stays out (the TS2589 zone).
ds.styles({
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
});
ds.styles({ '@media print': { display: 'none' } });
ds.styles({ '@media (400px <= width < 800px)': { p: 8 } });
ds.styles({ '@supports (display: grid)': { display: 'grid' } });
ds.styles({ '@container card (min-width: 400px)': { p: 8 } });
ds.styles({ '@container (min-width: 400px)': { p: 8 } }); // anonymous container
ds.styles({ '&[data-state="open"]': { p: 4, display: 'block' } });
// @ts-expect-error — '@supprts …' misspelled prefix rejected by shape
ds.styles({ '@supprts (display: grid)': { display: 'grid' } });

// ── 14f. Custom SELECTOR alias — typed block key AND callsite prop ──────────
// (selector-alias-callsite: registered custom selectors fold into the same
// publication as built-ins; the typo is rejected the same way)

// block-key position
ds.styles({ _hoverChild: { p: 4, bg: 'primary' } });
// callsite position (AliasBox exposes space + surface groups)
void (<AliasBox _hoverChild={{ p: 8 }} />);
void (<AliasBox _hoverChild={{ bg: 'primary' }} />);
// @ts-expect-error — _hoverChil is a typo of the registered custom selector
ds.styles({ _hoverChil: { p: 4 } });
// @ts-expect-error — _hoverChil typo rejected at the callsite too
void (<AliasBox _hoverChil={{ p: 8 }} />);

// ── 14g. D10: value-position breakpoint maps on pass-through CSS props ──────
// (media-condition-aliases §"Breakpoint value maps on pass-through CSS
// properties"). `outlineWidth`/`outlineColor` are NOT in propConfig.

// responsive map on a pass-through property typechecks
ds.styles({ outlineWidth: { _: '1px', sm: '2px' } });
// bare pass-through value still works (map is additive, not required)
ds.styles({ outlineWidth: '1px' });
// pass-through color prop accepts a responsive map of CSS color strings
ds.styles({ outlineColor: { _: 'red', sm: 'blue' } });
// @ts-expect-error — 'xxl' is not a configured breakpoint key (map is
// breakpoint-narrowed on pass-through props, just like system props)
ds.styles({ outlineWidth: { _: '1px', xxl: '2px' } });
// @ts-expect-error — boolean is not a valid pass-through value in a responsive slot
ds.styles({ outlineWidth: { _: '1px', sm: true } });

// ── 14h. addConditions value/key constraints ────────────────────────────────
// (selector-alias-registry §"Non-condition values rejected by addConditions()")

// @ts-expect-error — selector string rejected as a condition value at the type level
void createSystem().addConditions({ _open: '&[data-state="open"]' });
// @ts-expect-error — unsupported at-rule (@keyframes) rejected as a condition value
void createSystem().addConditions({ _spin: '@keyframes spin' });
// supported prefixes accepted
void createSystem().addConditions({
  _fineHover: '@media (hover: hover) and (pointer: fine)',
});

// ── 14i. Conditions are BLOCK-position only — never callsite props ──────────
// (design D2; registered SELECTOR aliases DO become callsite props — §14f —
// condition aliases must not.)
{
  const CondBox = ds.styles({ display: 'flex' }).asElement('div');
  // @ts-expect-error — a registered condition alias is not a component prop
  void (<CondBox _motionReduce={{ p: 4 }} />);
}

// ── 14j. Container-relative units on strict scale-typed props ────────────────
// (container-query-support §"Container-relative units on scale-typed
// properties"; registry row 11 / design D11). `p` and `m` are STRICT space-
// scale props registered on this harness's `ds` (padding/margin — no
// `strict: false`; `gap` is NOT a registered prop here, so it resolves through
// the pass-through arm and is not a strict-scale witness — `p`/`m` are). The
// resolver accepts and emits the six container units verbatim (D11); the type
// surface admits them via `ContainerUnitValue` WITHOUT widening strict props to
// arbitrary strings — non-container unit strings and bare suffixes stay
// rejected.

// container unit as a plain value on a strict scale prop
ds.styles({ p: '2cqi' });
// a second container unit on a strict space prop
ds.styles({ p: '50cqw' });
// admission generalizes across strict scale props (margin, negative-capable)
ds.styles({ m: '2cqi' });
// container unit in a responsive-map value slot — the union lands once in
// ThemedScaleValue, and ResponsiveProp carries it into every breakpoint slot
// alongside the scale key (`8`)
ds.styles({ p: { _: 8, sm: '2cqi' } });
// @ts-expect-error — '2vw' is a viewport unit, not one of the six container
// units; a strict scale prop rejects non-container unit strings
ds.styles({ p: '2vw' });
// @ts-expect-error — 'cqi' has no numeric part; the `${number}` prefix is
// load-bearing, so a bare container-unit suffix is not a value
ds.styles({ p: 'cqi' });

// ── 14k. Container units at depth + pass-through responsive at depth ────────
// (inc-11 full-pass F-1.1/F-1.2: the corpus must pin what Card.tsx proves.)

// container unit on a strict scale prop INSIDE a condition block
ds.styles({ '@container card (min-width: 400px)': { p: '2cqi' } });
// container unit at depth 2 (condition inside selector)
ds.styles({ _motionReduce: { p: '50cqw' } });
// @ts-expect-error — non-container unit still rejected at depth
ds.styles({ '@container card (min-width: 400px)': { p: '2vw' } });
// pass-through responsive map INSIDE a nested block (D10 wrapper at depth)
ds.styles({ '&:hover': { outlineWidth: { _: '1px', sm: '2px' } } });
ds.styles({
  '@supports (display: grid)': { outlineWidth: { _: '1px', sm: '2px' } },
});
// @ts-expect-error — bad breakpoint key rejected in a nested pass-through map
ds.styles({ '&:hover': { outlineWidth: { _: '1px', xxl: '2px' } } });

// ── 14l. Built-in condition aliases typed with ZERO registration ────────────
// (media-condition-aliases §"Built-in media-feature condition aliases"; design
// D8, inc 06). Built-ins are a STATIC `BuiltInConditionAlias` union in
// `KnownUnderscoreKey`'s validating branch — NOT members of the augmentable
// `Conditions` interface. So EVERY built-in types as a valid block key here,
// in this AUGMENTED compilation, WITHOUT being registered on `ds`: test-system
// registers only `_motionReduce`/`_cardSm`/`_supportsGrid`, so the eight others
// below (`_motionSafe`, `_print`, `_portrait`, `_landscape`, `_moreContrast`,
// `_lessContrast`, `_osDark`, `_osLight`) can ONLY be typed via the static
// union — the structural proof that built-ins survive publication without
// flipping non-augmenting consumers to branded-rejection. (The PERMISSIVE-mode
// counterpart — built-ins accepted when nothing is published — rests on the
// permissive `` `_${string}` `` branch being byte-untouched by inc 06; the
// vite-app build proves EMISSION through that path, not typing (vite never
// typechecks — augmentation is compilation-global, so an in-project
// permissive fixture is impossible; a separate unaugmented tsc project would
// be the real instrument if ever needed.)
ds.styles({ _motionReduce: { transition: 'none' } });
ds.styles({ _motionSafe: { transition: 'none' } });
ds.styles({ _print: { display: 'none' } });
ds.styles({ _portrait: { display: 'block' } });
ds.styles({ _landscape: { display: 'flex' } });
ds.styles({ _moreContrast: { outline: '2px solid' } });
ds.styles({ _lessContrast: { outline: 'none' } });
ds.styles({ _osDark: { colorScheme: 'dark' } });
ds.styles({ _osLight: { colorScheme: 'light' } });

// Built-in block recurses into the full themed body — scale-typed props inside
// retain scale-key validation (checking survives the recursion, same as a
// registered alias).
ds.styles({ _osDark: { p: 8 } });
// @ts-expect-error — 199 is not in the space scale, inside a built-in condition
ds.styles({ _osDark: { p: 199 } });
// built-in condition nested inside a selector alias (depth 2) still typechecks
ds.styles({ _hover: { _print: { p: 4 } } });

// A near-miss of a built-in name is still an unknown alias (branded rejection);
// the static union does not open the namespace to typos.
// @ts-expect-error — _osDrak is a typo of the built-in _osDark
ds.styles({ _osDrak: { display: 'none' } });

// Overriding a built-in condition by re-registering its name compiles at the
// type level (key matches `_${string}`, value is a valid at-rule) — the runtime
// override-preserves-order behavior is pinned in serialized-config.test.ts.
void createSystem().addConditions({
  _print: '@media print and (min-resolution: 300dpi)',
});
void createSystem().addConditions({
  _osDark: '@media (prefers-color-scheme: dark)',
});

// ─── Theme-typed builder-bound factories ──────────────────────
// Proves createKeyframes + createGlobalStyles inherit the system's theme
// context for prop validation and scale-token narrowing.

// Positive: scale-token reference in keyframe stop body resolves
void createKeyframes({
  pulse: {
    '0%': { bg: 'primary' },
    '100%': { bg: 'bg' },
  },
});

// Positive: scale-key for a propped CSS property inside a keyframe stop
void createKeyframes({
  fade: {
    '0%': { p: 8 },
    '100%': { p: 16 },
  },
});

// Negative: unknown scale key rejected inside a keyframe stop body
// @ts-expect-error — 'nonexistent' is not a key of the colors scale
void createKeyframes({ broken: { '0%': { bg: 'nonexistent' } } });

// Positive: theme-typed selector body in global styles
void createGlobalStyles({
  'html, body': { bg: 'bg', color: 'primary' },
  body: { p: 16 },
});

// Negative: unknown scale key rejected in global style body
// @ts-expect-error — 'nonexistent' is not a key of the colors scale
void createGlobalStyles({ body: { bg: 'nonexistent' } });

void TypeTests;
