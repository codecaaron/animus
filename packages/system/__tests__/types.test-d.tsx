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

import { createTheme } from '@animus-ui/theming';
import type { ComponentPropsWithRef, Ref, RefObject } from 'react';
import { useRef } from 'react';

import { createSystem, createTransform } from '../src';
import { color, layout, space, typography } from '../src/groups';

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

const ds = createSystem()
  .withTokens(() => tokens)
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
      sm: { p: '0.25rem' },
      lg: { p: '1rem' },
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

  // ── 6. HTML Attributes Pass Through ────────────────────────

  // ✅ Element-specific HTML attributes must compile
  <BtnBox type="submit" />;
  <BtnBox onClick={() => {}} />;
  <InputBox placeholder="type here" />;
  <DivBox role="banner" />;

  // ❌ Wrong element attributes should fail
  // @ts-expect-error — 'type' as submit is not valid on div
  <DivBox type="submit" />;

  return null;
}

void TypeTests;
