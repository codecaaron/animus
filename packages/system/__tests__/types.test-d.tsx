import type { ComponentPropsWithRef, RefObject } from 'react';
import { Component, forwardRef, useRef } from 'react';

import { compose, createSystem, createTheme, createTransform } from '../src';
import { composeWithContext } from '../src/composeWithContext';
import { createGlobalStyles, createKeyframes, ds, tokens } from './test-system';

import type { LibraryBundle, VocabularyOf } from '../src';
import type {
  AnyBrandedComponent,
  SharedConfig,
  VariantPropsOf,
} from '../src/types/component';
import type { Prop, ThemedCSSProps } from '../src/types/config';
import type {
  EmittedScales,
  EmittedTokenPaths,
  TokenScales,
} from '../src/types/theme';

type Assert<T extends true> = T;
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _testTransform = createTransform('testTransform', (v) => `${v}px`);

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

const Leaf = (props: { className?: string }) => <span {...props} />;

type DivBoxProps = ComponentPropsWithRef<typeof DivBox>;
type BtnBoxProps = ComponentPropsWithRef<typeof BtnBox>;
type InputBoxProps = ComponentPropsWithRef<typeof InputBox>;

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

type VariantBtnProps = ComponentPropsWithRef<typeof VariantBtn>;
type _VariantSize = Assert<
  IsExact<VariantBtnProps['size'], 'sm' | 'lg' | undefined>
>;

function TypeTests() {
  const divRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  <DivBox ref={divRef} />;
  <BtnBox ref={btnRef} />;
  <InputBox ref={inputRef} />;

  // @ts-expect-error — HTMLButtonElement ref on a div component
  <DivBox ref={btnRef} />;
  // @ts-expect-error — HTMLDivElement ref on a button component
  <BtnBox ref={divRef} />;
  // @ts-expect-error — HTMLDivElement ref on an input component
  <InputBox ref={divRef} />;

  <VariantBtn size="sm" />;
  <VariantBtn size="lg" />;
  <VariantBtn />;

  // @ts-expect-error — "xl" is not a declared variant
  <VariantBtn size="xl" />;
  // @ts-expect-error — number is not a valid variant value
  <VariantBtn size={42} />;

  <StatefulBox loading />;
  <StatefulBox disabled={false} />;
  <StatefulBox loading disabled />;

  // @ts-expect-error — "active" is not a declared state
  <StatefulBox active />;

  <SpaceOnly p={8} />;
  <SpaceOnly m={16} />;
  <TextOnly fontSize={16} />;

  <DivBox className="extra">children here</DivBox>;
  <DivBox className="x">click</DivBox>;
  <StatefulBox>content</StatefulBox>;

  type TestProps = { display: string; '&:hover': { color: string } };
  type TestConfig = Record<string, Prop>;
  type ResolvedNested = ThemedCSSProps<TestProps, TestConfig>;
  type _NestedNotUnknown = Assert<
    unknown extends ResolvedNested['&:hover'] ? false : true
  >;

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

  // @ts-expect-error — boolean is not a valid CSS or system prop value
  ds.styles({ '&:hover': { p: true } });
  // @ts-expect-error — boolean is not a valid CSS property value
  ds.styles({ '&:hover': { display: true } });
  // @ts-expect-error — 199 is not in the space scale (0 | 4 | 8 | 16)
  ds.styles({ '&:hover': { p: 199 } });

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

  ds.styles({
    '[aria-sort="ascending"] &': { color: 'red' },
    '[aria-sort="descending"] &:hover': { opacity: '0.8' },
    '.group:hover &': { p: 4 },
    '& + &': { p: 8 },
    '&:focus-visible, .group:hover &': { outline: '2px solid' },
  });
  // @ts-expect-error — ancestor selector bodies validate like any block body
  ds.styles({ '.group:hover &': { p: true } });
  // @ts-expect-error — 199 is not in the space scale inside an ancestor block
  ds.styles({ '[data-active="true"] &': { p: 199 } });

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

  ds.styles({ display: 'flex' }).states({
    loading: {
      '&::after': {
        content: '""',
        display: 'block',
      },
    },
  });

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

  <CompoundBtn size="sm" variant="fill" />;
  <CompoundBtn size="lg" />;
  <CompoundBtn />;

  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
    .compound({ size: 'sm' }, { p: 0 })
    .states({ loading: { opacity: '0.5' } })
    .asElement('div');

  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 } } })
    .states({ loading: { opacity: '0.5' } })
    .asElement('div');

  const _compoundsInstance = ds
    .styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 } } })
    .compound({ size: 'sm' }, { p: 0 });
  // @ts-expect-error — .variant() not available after .compound()
  _compoundsInstance.variant({ variants: { fill: { p: 0 } } });

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

  ds.styles({ display: 'flex' })
    .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
    .variant({
      variants: { fill: { opacity: '1' }, ghost: { opacity: '0.8' } },
    })
    .compound({ variant: ['fill', 'ghost'], size: 'sm' }, { p: 0 })
    .compound({ size: 'lg' }, { p: 8 })
    .asElement('button');

  <SpaceOnly m={-4} />;
  <SpaceOnly m={-8} />;
  <SpaceOnly m={-16} />;

  <SpaceOnly mt={-4} />;
  <SpaceOnly mb={-8} />;
  <SpaceOnly mx={-16} />;

  // @ts-expect-error — -99 is not a negated scale key (scale is 0|4|8|16)
  <SpaceOnly m={-99} />;

  // @ts-expect-error — padding does not support negative scale values
  <SpaceOnly p={-4} />;

  <BtnBox type="submit" />;
  <BtnBox onClick={() => {}} />;
  <InputBox placeholder="type here" />;
  <DivBox role="banner" />;

  // @ts-expect-error — 'type' as submit is not valid on div
  <DivBox type="submit" />;

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

  <SizedInput size="sm" placeholder="type here" />;

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

  <StrictLooseBox p={4} />;
  <StrictLooseBox p={16} />;

  // @ts-expect-error — strict scale: '2.5rem' is not a scale key
  <StrictLooseBox p="2.5rem" />;

  <StrictLooseBox gap={4} />;
  <StrictLooseBox gap={16} />;

  <StrictLooseBox gap="2.5rem" />;
  <StrictLooseBox gap="clamp(1rem, 2vw, 3rem)" />;

  <StrictLooseBox m={-4} />;
  <StrictLooseBox m={-16} />;

  <StrictLooseBox m="-2.5rem" />;

  <StrictLooseBox gap={{ xs: '1rem', sm: 8, md: '2.5rem' }} />;

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

  type TestSlots = {
    Root: typeof SlotRoot;
    Control: typeof SlotControl;
    Label: typeof SlotLabel;
  };

  type Config = SharedConfig<TestSlots>;
  type _ConfigHasSize = Assert<'size' extends keyof Config ? true : false>;
  type _ConfigHasTone = Assert<'tone' extends keyof Config ? true : false>;

  const Composed = compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { size: true } }
  );

  <Composed.Root size="sm">children</Composed.Root>;
  <Composed.Root size="lg" tone="bold">
    children
  </Composed.Root>;

  <Composed.Control className="extra" />;
  <Composed.Label>label text</Composed.Label>;

  <Composed.Control toggled="on" />;

  <Composed.Control size="lg" />;
  <Composed.Label size="lg">text</Composed.Label>;

  // @ts-expect-error — composed Root has no .extend()
  Composed.Root.extend;
  // @ts-expect-error — composed Control has no .extend()
  Composed.Control.extend;
  // @ts-expect-error — composed Label has no .extend()
  Composed.Label.extend;

  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { tone: true } }
  );

  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { size: true, tone: true } }
  );

  compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    // @ts-expect-error — 'toggled' is not a Root variant key
    { shared: { toggled: true } }
  );

  const Grouped = compose(
    { Root: SlotRoot, Control: SlotControl },
    { shared: {} }
  );
  <Grouped.Root size="sm" tone="bold">
    children
  </Grouped.Root>;
  <Grouped.Control toggled="on" />;

  compose({ Root: SlotRoot, Control: SlotControl }, { shared: { size: true } });

  compose(
    { Root: SlotRoot, Control: SlotControl },
    // @ts-expect-error — compose() has no context option
    { shared: { size: true }, context: true }
  );

  <SlotRoot asChild>
    <span>child</span>
  </SlotRoot>;

  <SlotRoot asChild={false}>children</SlotRoot>;

  // @ts-expect-error — asChild must be boolean, not string
  <SlotRoot asChild="yes">children</SlotRoot>;

  const WrappedRoot = ds
    .styles({ display: 'flex' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .variant({
      prop: 'tone',
      variants: { muted: { opacity: '0.6' }, bold: { opacity: '1' } },
    })
    .asComponent(Leaf);

  const WrappedControl = ds
    .styles({ display: 'block' })
    .variant({
      prop: 'size',
      variants: { sm: { p: 4 }, lg: { p: 16 } },
    })
    .asComponent(Leaf);

  type _WrappedIsBranded = Assert<
    typeof WrappedRoot extends AnyBrandedComponent ? true : false
  >;

  type WrappedConfig = SharedConfig<{
    Root: typeof WrappedRoot;
    Control: typeof WrappedControl;
  }>;
  type _WrappedConfigHasSize = Assert<
    'size' extends keyof WrappedConfig ? true : false
  >;
  type _WrappedConfigHasTone = Assert<
    'tone' extends keyof WrappedConfig ? true : false
  >;

  const WrappedComposed = compose(
    { Root: WrappedRoot, Control: WrappedControl },
    { shared: { size: true } }
  );
  <WrappedComposed.Root size="sm">children</WrappedComposed.Root>;
  <WrappedComposed.Control size="lg" />;

  compose(
    { Root: WrappedRoot, Control: WrappedControl },
    // @ts-expect-error — 'toggled' is not a variant key on the wrapped Root
    { shared: { toggled: true } }
  );

  compose(
    { Root: SlotRoot, Control: WrappedControl, Label: SlotLabel },
    { shared: { size: true } }
  );

  // @ts-expect-error — no exact "Root" slot
  compose({ Control: SlotControl, Label: SlotLabel }, { shared: {} });
  // @ts-expect-error — lowercase "root" is not Root (exact-key, case-sensitive)
  compose({ root: SlotRoot, Control: SlotControl }, { shared: {} });
  // @ts-expect-error — composeWithContext carries the same requirement
  composeWithContext({ Control: SlotControl }, { shared: {} });

  const Kept = compose(
    { Root: SlotRoot, Control: SlotControl, Label: SlotLabel },
    { shared: { size: true } }
  );
  type _KeptSlotKeys = Assert<
    IsExact<keyof typeof Kept, 'Root' | 'Control' | 'Label'>
  >;

  const _scaleBuilder1 = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({
      name: 'space',
      values: { 0: '0', 4: '0.25rem', 8: '0.5rem' },
    });

  const _scaleBuilder2 = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({
      name: 'sizes',
      emit: true,
      values: { navHeight: '48px' },
    });

  type Builder1Theme = ReturnType<(typeof _scaleBuilder1)['build']>;
  type _HasSpace = Assert<
    'space' extends keyof TokenScales<Builder1Theme> ? true : false
  >;

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

  type _StructuralKeysAreNotScales = Assert<
    Extract<
      | 'systemPreference'
      | 'browserColorScheme'
      | 'modeBases'
      | 'manifest'
      | 'serialize'
      | 'varRef'
      | '__emitted',
      keyof TokenScales<Builder3Theme>
    > extends never
      ? true
      : false
  >;

  createTheme()
    // @ts-expect-error — manifest is installed by build(), not a token scale
    .addScale({ name: 'manifest', values: { entry: 'x' } });
  createTheme()
    // @ts-expect-error — breakpoints are structural, not a token scale
    .extendScale('breakpoints', () => ({ wide: 1440 }));
  createTheme()
    // @ts-expect-error — contextual vars can only attach to token scales
    .declareContextualVars({ breakpoints: ['wide'] });

  type Builder2Theme = ReturnType<(typeof _scaleBuilder2)['build']>;
  type SizesType = Builder2Theme['sizes'];
  type _EmittedIsRaw = Assert<
    SizesType['navHeight'] extends string ? true : false
  >;

  type SpaceType = Builder1Theme['space'];
  type _RawIsString = Assert<SpaceType[0] extends string ? true : false>;

  type TestEmitted = EmittedScales<Builder2Theme>;
  type _EmittedHasSizes = Assert<'sizes' extends TestEmitted ? true : false>;

  type TestEmitted1 = EmittedScales<Builder1Theme>;
  type _SpaceNotEmitted = Assert<'space' extends TestEmitted1 ? false : true>;

  type TestTheme = typeof tokens;
  type TestColorsEmitted = EmittedScales<TestTheme>;
  type _ColorsEmitted = Assert<
    'colors' extends TestColorsEmitted ? true : false
  >;

  const _chainBuilder = createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({ name: 'space', values: { 8: '0.5rem' } })
    .addColors({ red: '#f00' })
    .addScale({ name: 'sizes', emit: true, values: { nav: '48px' } });

  type ChainTheme = ReturnType<(typeof _chainBuilder)['build']>;
  type ChainEmitted = EmittedScales<ChainTheme>;
  type _ChainHasColors = Assert<'colors' extends ChainEmitted ? true : false>;
  type _ChainHasSizes = Assert<'sizes' extends ChainEmitted ? true : false>;
  type _ChainNoSpace = Assert<'space' extends ChainEmitted ? false : true>;

  type ChainPaths = EmittedTokenPaths<ChainTheme>;
  type _HasColorsRed = Assert<'colors.red' extends ChainPaths ? true : false>;
  type _HasSizesNav = Assert<'sizes.nav' extends ChainPaths ? true : false>;
  type _NoSpacePath = Assert<'space.8' extends ChainPaths ? false : true>;

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

  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addScale({ name: 'sizes', emit: true, values: { navHeight: '48px' } })
    .addScale({
      name: 'layout',
      values: { stickyTop: 'calc({sizes.navHeight} + 16px)' },
    });

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

  type TestTokenScales = TokenScales<TestTheme>;
  type TestColors = TestTokenScales['colors'];
  type _ContextualBgInColors = Assert<
    'current-bg' extends keyof TestColors ? true : false
  >;

  type _PrimaryStillInColors = Assert<
    'primary' extends keyof TestColors ? true : false
  >;

  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    // @ts-expect-error — 'bogus' is not a scale in the theme
    .declareContextualVars({ bogus: ['x'] });

  ds.styles({ bg: 'current-bg' }).asElement('div');
  ds.styles({ borderColor: 'current-bg' }).asElement('div');
  ds.styles({ color: 'current-bg' }).asElement('div');
  ds.styles({ fill: 'current-bg' }).asElement('div');

  // @ts-expect-error — 'current-bg' is not in fontSizes scale
  ds.styles({ fontSize: 'current-bg' }).asElement('div');
  // @ts-expect-error — 'current-bg' is not in space scale
  ds.styles({ p: 'current-bg' }).asElement('div');

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

  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars(
      { colors: ['current-accent'] },
      { 'current-accent': { syntax: '*', inherits: false } }
    );

  createTheme()
    .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
    .addColors({ red: '#f00' })
    .declareContextualVars(
      { colors: ['current-bg'] },
      // @ts-expect-error — 'not-declared' is not a declared contextual var name
      { 'not-declared': { syntax: '<color>', inherits: true } }
    );

  ds.styles({ containerType: 'inline-size' }).asElement('div');
  ds.styles({ containerName: 'card' }).asElement('div');
  ds.styles({ container: 'card / inline-size' }).asElement('div');
  ds.styles({ containerType: 'inline-size', containerName: 'card' }).asElement(
    'section'
  );

  ds.styles({ display: 'flex' }).system({ space: true }).asElement('div');
  ds.styles({ display: 'flex' })
    .system({ surface: true, text: true })
    .asElement('div');

  ds.styles({ display: 'flex' }).system({ p: true }).asElement('div');
  ds.styles({ display: 'flex' }).system({ bg: true }).asElement('div');
  ds.styles({ display: 'flex' }).system({ fontSize: true }).asElement('div');

  ds.styles({ display: 'flex' }).system({ ratio: true }).asElement('div');

  ds.styles({ display: 'flex' })
    .system({ space: true, ratio: true })
    .asElement('div');
  ds.styles({ display: 'flex' })
    .system({ surface: true, p: true, ratio: true })
    .asElement('div');

  // @ts-expect-error — 'bogus' is not a group name or prop name
  ds.styles({ display: 'flex' }).system({ bogus: true }).asElement('div');
  // @ts-expect-error — 'nonexistent' is not in the system
  ds.styles({ display: 'flex' }).system({ nonexistent: true }).asElement('div');

  // @ts-expect-error — 'layout' is not a group name (it's 'arrange' in test fixture)
  ds.styles({ display: 'flex' }).system({ layout: true }).asElement('div');

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

  overlapDs.styles({ display: 'flex' }).system({ flex: true }).asElement('div');
  overlapDs.styles({ display: 'grid' }).system({ grid: true }).asElement('div');

  overlapDs
    .styles({ display: 'flex' })
    .system({ flex: true, gridTemplateColumns: true })
    .asElement('div');

  // @ts-expect-error — 'nope' is not a group or prop name
  overlapDs.styles({}).system({ nope: true }).asElement('div');

  const { system: ungroupedDs } = createSystem()
    .addGroup('space', {
      p: { property: 'padding', scale: 'space' } as const,
    })
    .addProps({
      customRatio: { property: 'aspectRatio' } as const,
    })
    .build();

  ungroupedDs
    .styles({ display: 'flex' })
    .system({ customRatio: true })
    .asElement('div');

  ungroupedDs
    .styles({ display: 'flex' })
    .system({ space: true, customRatio: true })
    .asElement('div');

  // @ts-expect-error — 'fake' is not registered
  ungroupedDs.styles({}).system({ fake: true }).asElement('div');

  const SinglePropBox = ds
    .styles({ display: 'flex' })
    .system({ p: true })
    .asElement('div');

  <SinglePropBox p={4} />;
  <SinglePropBox p={16} />;
  <SinglePropBox p={{ _: 4, md: 16 }} />;

  // @ts-expect-error — 'xxl' is not a configured breakpoint key
  <SinglePropBox p={{ _: 4, xxl: 16 }} />;
  // @ts-expect-error — 'mobile' is not a configured breakpoint key
  <SinglePropBox p={{ _: 4, mobile: 8 }} />;

  const GroupBox = ds
    .styles({ display: 'flex' })
    .system({ text: true })
    .asElement('div');

  <GroupBox fontSize={14} />;
  <GroupBox fontWeight={500} />;
  <GroupBox letterSpacing="-0.01em" />;

  const MixedBox = ds
    .styles({ display: 'flex' })
    .system({ space: true, ratio: true })
    .asElement('div');

  <MixedBox p={4} m={8} />;
  <MixedBox ratio="16:9" />;
  <MixedBox p={4} ratio="4:3" />;

  createSystem()
    .addProps({ gap: { property: 'gap' } as const })
    // @ts-expect-error — 'gap' is already a prop name
    .addGroup('gap', { spacing: { property: 'gap' } as const });

  createSystem()
    .addGroup('space', { p: { property: 'padding' } as const })
    // @ts-expect-error — 'space' collides with group name
    .addProps({ space: { property: 'padding' } as const });

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

  const LinkCard = BaseCard.extend()
    .styles({ textDecoration: 'none' })
    .asElement('a');

  <LinkCard href="/home" size="lg" intent="primary" />;
  <LinkCard href="/about" target="_blank" />;

  const SectionCard = BaseCard.extend().asElement('section');
  <SectionCard size="sm" intent="secondary" />;

  <LinkCard size="sm" />;
  <LinkCard size="lg" intent="secondary" />;

  const BigCard = BaseCard.extend()
    .variant({
      prop: 'size',
      variants: { xl: { p: 16, fontSize: 16 } },
    })
    .asElement('div');

  <BigCard size="xl" />;
  <BigCard size="sm" intent="primary" />;

  const ElevatedCard = BaseCard.extend()
    .variant({
      prop: 'elevation',
      variants: {
        flat: { boxShadow: 'none' },
        raised: { boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
      },
    })
    .asElement('div');

  <ElevatedCard size="md" intent="primary" elevation="raised" />;

  const StatefulCard = ds
    .styles({ display: 'block' })
    .states({ highlighted: { opacity: '1' } })
    .asElement('div');

  const ActiveCard = StatefulCard.extend()
    .states({ active: { bg: 'primary' } })
    .asElement('div');

  <ActiveCard active />;

  <StatefulCard highlighted />;

  const LayoutCard = BaseCard.extend().system({ space: true }).asElement('div');

  <LayoutCard p={8} m={4} size="sm" />;

  const CompoundCard = BaseCard.extend()
    .compound({ size: 'lg', intent: 'primary' }, { boxShadow: 'none' })
    .asElement('div');

  <CompoundCard size="lg" intent="primary" />;

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
  type _L3HasTone = Assert<'tone' extends keyof Level3Props ? true : false>;
  type _L3HasDensity = Assert<
    'density' extends keyof Level3Props ? true : false
  >;
  type _L3HasElevation = Assert<
    'elevation' extends keyof Level3Props ? true : false
  >;

  <Level3 tone="muted" density="tight" elevation="low" />;

  // @ts-expect-error — the styles() stage is not a terminal
  ds.styles({ display: 'flex' }).extend();

  ds.styles({ display: 'flex' })
    .variant({ prop: 'tone', variants: { muted: { opacity: '0.5' } } })
    // @ts-expect-error — the variant() stage is not a terminal
    .extend();

  // @ts-expect-error — the system() stage is not a terminal
  ds.styles({ display: 'flex' }).system({ space: true }).extend();

  BaseCard.extend()
    .styles({ display: 'grid' })
    // @ts-expect-error — an extension chain is not a terminal until it ends in one
    .extend();

  const ReExtendedLevel3 = Level3.extend()
    .styles({ display: 'flex' })
    .asElement('div');
  <ReExtendedLevel3 tone="muted" density="tight" elevation="low" />;

  return null;
}

ds.styles({}).props({
  sizing: {
    property: 'width',
    transform: (val: string | number) =>
      typeof val === 'number' ? `${val}px` : val,
  },
});

ds.styles({}).props({
  sizing: {
    property: 'width',
    transform: (val: string | number) => ({ width: `${val}px` }),
  },
});

const AliasBox = ds
  .styles({ display: 'flex' })
  .system({ space: true, surface: true })
  .asElement('div');

void (<AliasBox _hover={{ p: 8 }} />);
void (<AliasBox _hover={{ bg: 'primary' }} />);
void (<AliasBox _disabled={{ p: 16 }} />);
void (<AliasBox _before={{ p: 8 }} />);
void (<AliasBox _active={{ bg: 'red' }} />);
void (<AliasBox _focusVisible={{ p: 8, bg: 'primary' }} />);

void (<AliasBox p={8} bg="primary" _hover={{ bg: 'red' }} />);

// @ts-expect-error — _groupHover is not a built-in alias
void (<AliasBox _groupHover={{ p: 8 }} />);

const ExtendedAlias = AliasBox.extend()
  .styles({ display: 'grid' })
  .asElement('section');
void (<ExtendedAlias _hover={{ p: 8 }} />);
void (<ExtendedAlias _disabled={{ bg: 'red' }} />);

import { BUILT_IN_SELECTORS } from '../src/selectors';

import type { BuiltInSelectorAlias } from '../src/types/config';

type AssertAllKeysAreAliases = {
  [K in keyof typeof BUILT_IN_SELECTORS]: K extends BuiltInSelectorAlias
    ? true
    : never;
};
void (0 as unknown as AssertAllKeysAreAliases);

import type { ConditionsOf, SelectorsOf } from '../src';

type _CondsPublished = Assert<
  IsExact<
    ConditionsOf<typeof ds>,
    '_motionReduce' | '_cardSm' | '_supportsGrid'
  >
>;
type _SelsPublished = Assert<IsExact<SelectorsOf<typeof ds>, '_hoverChild'>>;

ds.styles({ _motionReduce: { transition: 'none' } });
ds.styles({ display: 'flex' }).variant({
  prop: 'size',
  base: { _cardSm: { p: 8 } },
  variants: {
    sm: { _motionReduce: { transition: 'none' } },
    lg: { _supportsGrid: { display: 'grid' } },
  },
});
ds.styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .compound({ size: 'sm' }, { _supportsGrid: { display: 'grid' } });
ds.styles({ display: 'flex' }).states({
  loading: { _motionReduce: { transition: 'none' } },
});

// @ts-expect-error — _motionReduc is not a registered condition/selector alias
ds.styles({ _motionReduc: { transition: 'none' } });
// @ts-expect-error — _bogusAlias is unregistered (UnknownConditionAlias)
ds.styles({ _bogusAlias: { p: 4 } });
// @ts-expect-error — '@containr …' is a misspelled at-rule prefix (UnknownAtRule)
ds.styles({ '@containr card (min-width: 400px)': { p: 8 } });
// @ts-expect-error — '@medai …' misspelled prefix
ds.styles({ '@medai (min-width: 400px)': { p: 8 } });

ds.styles({ _motionReduce: { p: 8 } });
// @ts-expect-error — 199 is not in the space scale, inside a condition alias
ds.styles({ _motionReduce: { p: 199 } });
ds.styles({ _hover: { _cardSm: { p: 4 } } });
// @ts-expect-error — 199 not in scale at depth 2 (checking survives recursion)
ds.styles({ _hover: { _cardSm: { p: 199 } } });

ds.styles({
  _hover: {
    _cardSm: {
      '&:focus-visible': {
        _supportsGrid: {
          _motionReduce: {
            '&::after': {
              _hoverChild: {
                p: 4,
              },
            },
          },
        },
      },
    },
  },
});
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

ds.styles({
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
});
ds.styles({ '@media print': { display: 'none' } });
ds.styles({ '@media (400px <= width < 800px)': { p: 8 } });
ds.styles({ '@supports (display: grid)': { display: 'grid' } });
ds.styles({ '@container card (min-width: 400px)': { p: 8 } });
ds.styles({ '@container (min-width: 400px)': { p: 8 } });
ds.styles({ '&[data-state="open"]': { p: 4, display: 'block' } });
// @ts-expect-error — '@supprts …' misspelled prefix rejected by shape
ds.styles({ '@supprts (display: grid)': { display: 'grid' } });

ds.styles({ _hoverChild: { p: 4, bg: 'primary' } });
void (<AliasBox _hoverChild={{ p: 8 }} />);
void (<AliasBox _hoverChild={{ bg: 'primary' }} />);
// @ts-expect-error — _hoverChil is a typo of the registered custom selector
ds.styles({ _hoverChil: { p: 4 } });
// @ts-expect-error — _hoverChil typo rejected at the callsite too
void (<AliasBox _hoverChil={{ p: 8 }} />);

ds.styles({ outlineWidth: { _: '1px', sm: '2px' } });
ds.styles({ outlineWidth: '1px' });
ds.styles({ outlineColor: { _: 'red', sm: 'blue' } });
// @ts-expect-error — 'xxl' is not a configured breakpoint key
ds.styles({ outlineWidth: { _: '1px', xxl: '2px' } });
// @ts-expect-error — boolean is not a valid pass-through value in a responsive slot
ds.styles({ outlineWidth: { _: '1px', sm: true } });

// @ts-expect-error — selector string rejected as a condition value at the type level
void createSystem().addConditions({ _open: '&[data-state="open"]' });
// @ts-expect-error — unsupported at-rule (@keyframes) rejected as a condition value
void createSystem().addConditions({ _spin: '@keyframes spin' });
void createSystem().addConditions({
  _fineHover: '@media (hover: hover) and (pointer: fine)',
});

{
  const CondBox = ds.styles({ display: 'flex' }).asElement('div');
  // @ts-expect-error — a registered condition alias is not a component prop
  void (<CondBox _motionReduce={{ p: 4 }} />);
}

ds.styles({ p: '2cqi' });
ds.styles({ p: '50cqw' });
ds.styles({ m: '2cqi' });
ds.styles({ p: { _: 8, sm: '2cqi' } });
// @ts-expect-error — '2vw' is a viewport unit, not one of the six container
// units; a strict scale prop rejects non-container unit strings
ds.styles({ p: '2vw' });
// @ts-expect-error — 'cqi' has no numeric part; the `${number}` prefix is
// load-bearing, so a bare container-unit suffix is not a value
ds.styles({ p: 'cqi' });

ds.styles({ '@container card (min-width: 400px)': { p: '2cqi' } });
ds.styles({ _motionReduce: { p: '50cqw' } });
// @ts-expect-error — non-container unit still rejected at depth
ds.styles({ '@container card (min-width: 400px)': { p: '2vw' } });
ds.styles({ '&:hover': { outlineWidth: { _: '1px', sm: '2px' } } });
ds.styles({
  '@supports (display: grid)': { outlineWidth: { _: '1px', sm: '2px' } },
});
// @ts-expect-error — bad breakpoint key rejected in a nested pass-through map
ds.styles({ '&:hover': { outlineWidth: { _: '1px', xxl: '2px' } } });

ds.styles({ _motionReduce: { transition: 'none' } });
ds.styles({ _motionSafe: { transition: 'none' } });
ds.styles({ _print: { display: 'none' } });
ds.styles({ _portrait: { display: 'block' } });
ds.styles({ _landscape: { display: 'flex' } });
ds.styles({ _moreContrast: { outline: '2px solid' } });
ds.styles({ _lessContrast: { outline: 'none' } });
ds.styles({ _osDark: { colorScheme: 'dark' } });
ds.styles({ _osLight: { colorScheme: 'light' } });

ds.styles({ _osDark: { p: 8 } });
// @ts-expect-error — 199 is not in the space scale, inside a built-in condition
ds.styles({ _osDark: { p: 199 } });
ds.styles({ _hover: { _print: { p: 4 } } });

// @ts-expect-error — _osDrak is a typo of the built-in _osDark
ds.styles({ _osDrak: { display: 'none' } });

void createSystem().addConditions({
  _print: '@media print and (min-resolution: 300dpi)',
});
void createSystem().addConditions({
  _osDark: '@media (prefers-color-scheme: dark)',
});

{
  // @ts-expect-error — _expanded is a built-in SELECTOR alias
  void createSystem().addConditions({ _expanded: '@media (min-width: 40em)' });
  // @ts-expect-error — _print is a built-in CONDITION alias
  void createSystem().addSelectors({ _print: '&[data-print]' });

  const userSels = createSystem().addSelectors({ _open: '&[data-open]' });
  // @ts-expect-error — _open is already registered as a USER selector alias
  void userSels.addConditions({ _open: '@media (hover: hover)' });

  const userConds = createSystem().addConditions({ _paper: '@media print' });
  // @ts-expect-error — _paper is already registered as a USER condition alias
  void userConds.addSelectors({ _paper: '&[data-paper]' });

  void createSystem().addSelectors({
    _disabled: '&:disabled, &[data-state="disabled"]',
  });

  const kitSys = createSystem()
    .addConditions({ _kitCond: '@media print' })
    .addSelectors({ _kitSel: '&[data-kit]' })
    .build().system;
  const kitConsumer = createSystem().extend(kitSys);
  // @ts-expect-error — _kitCond arrived as a CONDITION alias through extend()
  void kitConsumer.addSelectors({ _kitCond: '&[data-x]' });
  // @ts-expect-error — _kitSel arrived as a SELECTOR alias through extend()
  void kitConsumer.addConditions({ _kitSel: '@media print' });

  const widenedConds: Record<`_${string}`, `@media${string}`> = {
    _dyn: '@media (min-width: 30em)',
  };
  const widened = createSystem().addConditions(widenedConds);
  void widened.addSelectors({ _hoverChild: '&:hover > *' });
  // @ts-expect-error — a built-in CONDITION alias still rejects after widening
  void widened.addSelectors({ _print: '&[data-print]' });

  const widenedBuilt = widened
    .addConditions({ _dense: '@media print' })
    .build();
  type _WidenedContributesNothing = Assert<
    IsExact<ConditionsOf<typeof widenedBuilt.system>, '_dense'>
  >;
  // @ts-expect-error — _madeUpAlias is unregistered (UnknownConditionAlias)
  ds.styles({ _madeUpAlias: { p: 4 } });

  const liveGate = createSystem()
    .addSelectors({ _pane: '&[data-pane]' })
    .addConditions({ _dense: '@media print' })
    .build();
  type _CondsInferenceSurvives = Assert<
    IsExact<ConditionsOf<typeof liveGate.system>, '_dense'>
  >;
}

void createKeyframes({
  pulse: {
    '0%': { bg: 'primary' },
    '100%': { bg: 'bg' },
  },
});

void createKeyframes({
  fade: {
    '0%': { p: 8 },
    '100%': { p: 16 },
  },
});

// @ts-expect-error — 'nonexistent' is not a key of the colors scale
void createKeyframes({ broken: { '0%': { bg: 'nonexistent' } } });

void createGlobalStyles({
  'html, body': { bg: 'bg', color: 'primary' },
  body: { p: 16 },
});

void createGlobalStyles(
  { body: { p: 16 } },
  {
    fontFaces: [
      {
        family: 'Inter',
        src: [{ url: '/fonts/inter.woff2', format: 'woff2' }],
        weight: '100 900',
        display: 'swap',
      },
    ],
  }
);

void createGlobalStyles(
  { body: { p: 16 } },
  {
    fontFaces: [
      // @ts-expect-error — 'variant' is not a FontFace descriptor
      { family: 'Inter', src: [{ url: '/f.woff2' }], variant: 'small-caps' },
    ],
  }
);

// @ts-expect-error — 'nonexistent' is not a key of the colors scale
void createGlobalStyles({ body: { bg: 'nonexistent' } });

// strictFunctionTypes is off in this project, so only the class-component case
// below is non-vacuous here; the other arms hold for strict consumers.

interface BadgeProps {
  label: string;
  className?: string;
}

function Badge({ label, className }: BadgeProps) {
  return <span className={className}>{label}</span>;
}

const ForwardedBadge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ label, className }, ref) => (
    <span className={className} ref={ref}>
      {label}
    </span>
  )
);

class ClassBadge extends Component<BadgeProps> {
  render() {
    return <span className={this.props.className}>{this.props.label}</span>;
  }
}

const StyledBadge = ds
  .styles({ display: 'inline-flex' })
  .variant({
    prop: 'tone',
    variants: { calm: { opacity: '1' }, loud: { opacity: '0.5' } },
  })
  .asComponent(Badge);

const _StyledForwardedBadge = ds
  .styles({ display: 'inline-flex' })
  .asComponent(ForwardedBadge);

const _StyledClassBadge = ds
  .styles({ display: 'inline-flex' })
  .asComponent(ClassBadge);

void (<StyledBadge label="hi" className="extra" tone="calm" />);

// @ts-expect-error — `label` is required by the wrapped Badge
void (<StyledBadge tone="calm" />);

const ExtendedBadge = StyledBadge.extend()
  .styles({ display: 'flex' })
  .asComponent(Badge);
void (<ExtendedBadge label="hi" />);

{
  const kitBuild = createSystem()
    .addGroup('kitSurface', {
      kitGlow: { property: 'boxShadow' },
    })
    .build();
  const kitDs = kitBuild.system;
  const kitBundle = {
    system: kitDs,
    tokens: { colors: { externalAccent: '#f0f' } },
  };

  void createSystem()
    .from(kitDs)
    .from(kitDs)
    .addGroup('space', { m: { property: 'margin' } })
    .build();

  const { system: fromBundle } = createSystem().from(kitBundle).build();
  void fromBundle.styles({ kitGlow: '0 0 4px' }).system({ kitSurface: true });

  const { system: fromThemeBundle } = createSystem()
    .from({ system: kitDs, theme: { colors: { accent: '#f0f' } } })
    .build();
  void fromThemeBundle
    .styles({ kitGlow: '0 0 4px' })
    .system({ kitSurface: true });

  const { system: consumer } = createSystem()
    .from(kitDs)
    .addGroup('space', { m: { property: 'margin', scale: 'space' } })
    .build();
  void consumer.styles({}).system({ kitSurface: true, space: true });

  // @ts-expect-error — 'extend'-stage builder has no callable from()
  void createSystem()
    .addGroup('space', { m: { property: 'margin' } })
    .from(kitDs);

  const { system: aliased } = createSystem({ includes: [kitDs] })
    .addGroup('space', { m: { property: 'margin' } })
    .build();
  // @ts-expect-error — 'kitSurface' is not a group on the alias consumer
  void aliased.styles({}).system({ kitSurface: true, space: true });

  // @ts-expect-error — plain object is neither shape
  void createSystem().from({ notASystem: true });

  const publishedBundle: LibraryBundle = kitBundle;
  const { system: fromPublished } = createSystem()
    .from(publishedBundle)
    .addGroup('space', { m: { property: 'margin' } })
    .build();
  void fromPublished.styles({}).system({ space: true });
  // @ts-expect-error — annotated bundle admits no source types
  void fromPublished.styles({}).system({ kitSurface: true });
  void createTheme().from(publishedBundle).addColors({ ink: '#111' }).build();
}

{
  const kitBuild = createSystem()
    .addGroup('kitSurface', {
      kitGlow: { property: 'boxShadow' },
    })
    .build();
  const kitDs = kitBuild.system;
  const kitBundle = {
    system: kitDs,
    theme: { colors: { externalAccent: '#f0f' } },
  };

  void createSystem()
    .extend(kitDs)
    .extend(kitDs)
    .addGroup('space', { m: { property: 'margin' } })
    .build();

  const { system: extendBundle } = createSystem().extend(kitBundle).build();
  void extendBundle.styles({ kitGlow: '0 0 4px' }).system({ kitSurface: true });

  const { system: consumer } = createSystem()
    .extend(kitDs)
    .addGroup('space', { m: { property: 'margin', scale: 'space' } })
    .build();
  void consumer.styles({}).system({ kitSurface: true, space: true });

  // @ts-expect-error — 'extend'-stage builder has no callable extend()
  void createSystem()
    .addProps({ m: { property: 'margin' } })
    .extend(kitDs);

  // @ts-expect-error — plain object is neither shape
  void createSystem().extend({ notASystem: true });

  const publishedBundle: LibraryBundle = kitBundle;
  const { system: extendPublished } = createSystem()
    .extend(publishedBundle)
    .addGroup('space', { m: { property: 'margin' } })
    .build();
  void extendPublished.styles({}).system({ space: true });
  // @ts-expect-error — annotated bundle admits no source types
  void extendPublished.styles({}).system({ kitSurface: true });
}

{
  const kitTheme = createTheme()
    .addBreakpoints({ sm: 768 })
    .addColors({ ember: '#ff2800' })
    .addScale({ name: 'kitSpace', values: { 4: '0.25rem' } })
    .build();
  const kitDs = createSystem()
    .addGroup('kitSurface', { kitGlow: { property: 'boxShadow' } })
    .build().system;

  void createTheme()
    .extend(kitTheme)
    .extendScale('kitSpace', () => ({ 8: '0.5rem' }))
    .build();

  const extendedKitTheme = createTheme().extend(kitTheme).build();
  type _ExtendedThemeKeepsEmittedColors = Assert<
    'colors' extends EmittedScales<typeof extendedKitTheme> ? true : false
  >;

  void createTheme()
    .extend(kitTheme)
    .extend(kitTheme)
    .addColors({ ink: '#111111' })
    .build();

  void createTheme()
    .extend({ system: kitDs, theme: kitTheme })
    .extendScale('kitSpace', () => ({ 8: '0.5rem' }))
    .build();

  void createTheme()
    .extend({ system: kitDs, tokens: kitTheme })
    .extendScale('kitSpace', () => ({ 8: '0.5rem' }))
    .build();

  // @ts-expect-error — 'extend'-stage builder has no callable extend()
  void createTheme().addColors({ ink: '#111111' }).extend(kitTheme);

  void createTheme().addColors({ ink: '#111111' }).from(kitTheme).build();
  void createTheme().extend(kitTheme).from(kitTheme).build();

  const publishedBundle: LibraryBundle = {
    system: kitDs,
    theme: kitTheme,
  };
  void createTheme()
    .extend(publishedBundle)
    .addColors({ ink: '#111111' })
    .build();

  class ThemeWithMethod {
    spacing = { sm: '4px' };
    ghostMethod() {}
  }
  const extendedClassTheme = createTheme()
    .extend(new ThemeWithMethod())
    .build();
  void extendedClassTheme.spacing.sm;
  // @ts-expect-error — runtime composition skips function-valued members
  extendedClassTheme.ghostMethod();

  const maybeCallable: { slot: string | (() => string) } = {
    slot: () => 'runtime skips this value',
  };
  const extendedMaybeCallable = createTheme().extend(maybeCallable).build();
  // @ts-expect-error — maybe-callable values cannot be promised as copied data
  extendedMaybeCallable.slot;
}

{
  const kitBuild = createSystem()
    .addGroup('kitSurface', { kitGlow: { property: 'boxShadow' } })
    .build();
  const kitMotion = kitBuild.createKeyframes({
    pulse: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
  });
  const sealedKit = kitBuild.registerKeyframes({ kitMotion }).seal();

  void sealedKit.styles({}).system({ kitSurface: true });
  void sealedKit.toConfig();
  void sealedKit.getVocabularyRecord();

  type _KitVocab = Assert<IsExact<VocabularyOf<typeof sealedKit>, 'kitMotion'>>;

  const plainSealed = createSystem().build().seal();
  type _EmptyVocab = Assert<IsExact<VocabularyOf<typeof plainSealed>, never>>;

  const dupBundle = createSystem().build();
  const motion = dupBundle.createKeyframes({ spin: { '0%': { opacity: 0 } } });
  void dupBundle
    .registerKeyframes({ motion })
    // @ts-expect-error — "motion" is already registered vocabulary
    .registerKeyframes({ motion });

  // @ts-expect-error — sealed instances have no registerKeyframes member
  void sealedKit.registerKeyframes;

  void createSystem()
    .build()
    // @ts-expect-error — shape mismatch: not a Keyframes collection
    .registerKeyframes({ bogus: { frames: {} } });

  const consumerBundle = createSystem().extend(sealedKit).build();
  const consumerMotion = consumerBundle.createKeyframes({
    blink: { '0%': { opacity: 1 } },
  });
  // @ts-expect-error — "kitMotion" is inherited vocabulary from the kit
  void consumerBundle.registerKeyframes({ kitMotion: consumerMotion });
  const consumerSealed = consumerBundle
    .registerKeyframes({ appMotion: consumerMotion })
    .seal();
  type _MergedVocab = Assert<
    IsExact<VocabularyOf<typeof consumerSealed>, 'kitMotion' | 'appMotion'>
  >;

  const viaLiteral = createSystem().extend({ system: sealedKit }).build();
  // @ts-expect-error — "kitMotion" arrives through the bundle's sealed half
  void viaLiteral.registerKeyframes({ kitMotion: consumerMotion });

  const publishedVocabBundle: LibraryBundle<'kitMotion'> = {
    system: sealedKit,
  };
  const viaAnnotated = createSystem().extend(publishedVocabBundle).build();
  // @ts-expect-error — "kitMotion" arrives through the annotated bundle axis
  void viaAnnotated.registerKeyframes({ kitMotion: consumerMotion });

  const publishedErased: LibraryBundle = { system: sealedKit };
  const viaErased = createSystem().extend(publishedErased).build();
  const erasedSealed = viaErased
    .registerKeyframes({ kitMotion: consumerMotion })
    .seal();
  type _ErasedVocab = Assert<
    IsExact<VocabularyOf<typeof erasedSealed>, 'kitMotion'>
  >;

  // Unsealed extend(<built instance>).build() must stay cheap: the vocabulary
  // axis must not push inference into TS2589/TS2859 territory.
  const unsealedKit = createSystem()
    .addGroup('kitSurface', { kitGlow: { property: 'boxShadow' } })
    .build().system;
  void createSystem().extend(unsealedKit).build();
  void createSystem()
    .extend(unsealedKit)
    .addConditions({ _cardSm: '@container card (min-width: 200px)' })
    .build();

  const widened: Record<string, typeof kitMotion> = { anything: kitMotion };
  // @ts-expect-error — index-signature maps cannot register vocabulary
  void createSystem().build().registerKeyframes(widened);

  const gsBundle = createSystem().build();
  const gsMotion = gsBundle.createKeyframes({
    spin: { '0%': { opacity: 0 } },
  });
  const gsReset = gsBundle.createGlobalStyles({ body: { margin: 0 } });
  void gsBundle
    .registerKeyframes({ motion: gsMotion })
    // @ts-expect-error — "motion" is already registered vocabulary
    .registerGlobalStyles({ motion: gsReset });
  const gsSealed = gsBundle
    .registerKeyframes({ motion: gsMotion })
    .registerGlobalStyles({ gsReset })
    .seal();
  type _MixedVocab = Assert<
    IsExact<VocabularyOf<typeof gsSealed>, 'motion' | 'gsReset'>
  >;
}

void TypeTests;
