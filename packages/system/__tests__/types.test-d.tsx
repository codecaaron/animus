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

import { compose, createTransform } from '../src';
import type { SharedConfig, VariantPropsOf } from '../src/types/component';
import type { Prop, ThemedCSSProps } from '../src/types/config';
import { ds } from './test-system';

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
  .groups({ space: true })
  .asElement('div');

const TextOnly = ds
  .styles({ display: 'flex' })
  .groups({ text: true })
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

  // @ts-expect-error — 'toggled' is not a Root variant key
  compose({ Root: SlotRoot, Control: SlotControl, Label: SlotLabel }, { shared: { toggled: true } });

  // ── 10f. compose() — empty shared config is valid ───────────

  const Grouped = compose(
    { Root: SlotRoot, Control: SlotControl },
    { shared: {} }
  );
  <Grouped.Root size="sm" tone="bold">
    children
  </Grouped.Root>;
  <Grouped.Control toggled="on" />;

  return null;
}

void TypeTests;
