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

import { createSystem, createTheme, createTransform } from '../src';
import { color, layout, space, typography } from '../src/groups';
import type { Prop, ThemedCSSProps } from '../src/types/config';

// ─── Type Utilities ─────────────────────────────────────────

type Assert<T extends true> = T;
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ─── Test Fixture ───────────────────────────────────────────

const _testTransform = createTransform('testTransform', (v) => `${v}px`);

const tokens = createTheme({
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
})
  .addScale('space', () => ({
    0: '0',
    4: '0.25rem',
    8: '0.5rem',
    16: '1rem',
  }))
  .addScale('fontSizes', () => ({
    14: '0.875rem',
    16: '1rem',
  }))
  .addColors({ red: '#f00', blue: '#00f' })
  .addColorModes('dark', {
    dark: { primary: 'red', bg: 'blue' },
    light: { primary: 'blue', bg: 'red' },
  })
  .build();

type TestTheme = typeof tokens;

declare module '../src' {
  interface Theme extends TestTheme {}
}

const ds = createSystem()
  .withProperties((p) =>
    p
      .addGroup('space', space)
      .addGroup('text', typography)
      .addGroup('surface', color)
      .addGroup('arrange', layout)
      .build()
  )
  .build();

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

  // ── 7. HTML Attributes Pass Through ────────────────────────

  // ✅ Element-specific HTML attributes must compile
  <BtnBox type="submit" />;
  <BtnBox onClick={() => {}} />;
  <InputBox placeholder="type here" />;
  <DivBox role="banner" />;

  // ❌ Wrong element attributes must fail
  // @ts-expect-error — 'type' as submit is not valid on div
  <DivBox type="submit" />;

  return null;
}

void TypeTests;
