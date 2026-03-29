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

import type { ComponentPropsWithRef, Ref, RefObject } from 'react';
import { useRef } from 'react';

import { compose, createSystem, createTheme, createTransform } from '../src';
import type { SharedConfig, VariantPropsOf } from '../src/types/component';
import type { Prop, ThemedCSSProps } from '../src/types/config';
import type {
  EmittedScales,
  EmittedTokenPaths,
  TokenScales,
} from '../src/types/theme';
import { ds, tokens } from './test-system';

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

  // ── 11. addScale Config Object ─────────────────────────────

  // ✅ Config object with name + values compiles
  const _scaleBuilder1 = createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  }).addScale({
    name: 'space',
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem' },
  });

  // ✅ Config object with emit: true compiles
  const _scaleBuilder2 = createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  }).addScale({
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
  const _scaleBuilder3 = createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
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

  // ✅ Emitted scale values resolve to var() type
  type Builder2Theme = ReturnType<(typeof _scaleBuilder2)['build']>;
  type SizesType = Builder2Theme['sizes'];
  type _EmittedIsVar = Assert<
    SizesType['navHeight'] extends `var(--${string})` ? true : false
  >;

  // ✅ Non-emitted scale values remain raw
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
  const _chainBuilder = createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
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
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ ember: '#ff2800' })
    .addColorModes('dark', {
      dark: { text: 'ember' },
      light: { text: 'ember' },
    })
    .addScale({
      name: 'shadows',
      values: { glow: '0 0 12px {colors.text}' },
    });

  // ❌ Token ref to non-emitted scale must fail
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addScale({ name: 'borders', values: { 1: '1px solid ' } })
    .addScale({
      name: 'test',
      // @ts-expect-error — 'borders' is not emitted, {borders.1} is invalid
      values: { bad: '{borders.1}' },
    });

  // ❌ Token ref to valid scale but nonexistent key must fail
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ ember: '#ff2800' })
    .addColorModes('dark', {
      dark: { text: 'ember' },
      light: { text: 'ember' },
    })
    .addScale({
      name: 'shadows',
      // @ts-expect-error — 'nonexistent' is not a key in colors
      values: { glow: '0 0 12px {colors.nonexistent}' },
    });

  // ❌ Token ref to emitted scale with wrong key must fail
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
    .addScale({
      name: 'layout',
      // @ts-expect-error — 'bogus' is not a key in sizes
      values: { broken: 'calc({sizes.bogus} + 16px)' },
    });

  // ✅ Token ref to emitted scale with valid key compiles
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
    .addScale({
      name: 'layout',
      values: { stickyTop: 'calc({sizes.navHeight} + 16px)' },
    });

  // ── 11f. Opacity syntax — colors only ────────────────────

  // ✅ {colors.key/number} compiles for valid color keys
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ ember: '#ff2800' })
    .addColorModes('dark', {
      dark: { text: 'ember', glow: 'ember' },
      light: { text: 'ember', glow: 'ember' },
    })
    .addScale({
      name: 'elevation',
      values: { glow: '0 0 8px {colors.glow/40}' },
    });

  // ❌ Opacity syntax on non-color scale must fail
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
    .addScale({
      name: 'test',
      // @ts-expect-error — opacity syntax only valid for colors
      values: { bad: '{sizes.navHeight/50}' },
    });

  // ❌ Opacity syntax with invalid color key must fail
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ ember: '#ff2800' })
    .addScale({
      name: 'test',
      // @ts-expect-error — 'bogus' is not a color key
      values: { bad: '{colors.bogus/40}' },
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

  // ❌ addContextualVars with nonexistent scale produces type error
  createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ red: '#f00' })
    // @ts-expect-error — 'bogus' is not a scale in the theme
    .addContextualVars({ bogus: ['x'] });

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
  const _ctxBuilder = createTheme({
    breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
  })
    .addColors({ red: '#f00' })
    .addContextualVars({
      colors: ['current-bg', 'current-border'],
    });

  type CtxTheme = ReturnType<(typeof _ctxBuilder)['build']>;
  type CtxColors = TokenScales<CtxTheme>['colors'];
  type _CtxHasBg = Assert<'current-bg' extends keyof CtxColors ? true : false>;
  type _CtxHasBorder = Assert<
    'current-border' extends keyof CtxColors ? true : false
  >;

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
  ds.styles({ display: 'flex' })
    .system({ fontSize: true })
    .asElement('div');

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
  overlapDs
    .styles({ display: 'flex' })
    .system({ flex: true })
    .asElement('div');
  overlapDs
    .styles({ display: 'grid' })
    .system({ grid: true })
    .asElement('div');

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

  return null;
}

void TypeTests;
