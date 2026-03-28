import {
  Heading,
  InlineCode,
  Label,
  Mono,
  Prose,
  Stack,
  SyntaxBlock,
  TableContainer,
  Td,
  Th,
} from '../components';

export default function ApiReference() {
  return (
    <Stack gap={64} maxWidth="48rem" mx="auto" px={{ _: 24, md: 48 }} py={64}>
      {/* createTheme() */}
      <Stack gap={24}>
        <Heading level={2}>createTheme()</Heading>
        <Stack gap={8}>
          <Label>signature</Label>
          <Mono fontSize={13} color="code-text">
            {'createTheme<T extends AbstractTheme>(base: T): ThemeBuilder<T>'}
          </Mono>
        </Stack>
        <Prose fontSize={14} lineHeight="relaxed">
          Initializes a typed theme builder from a base object. Typically only{' '}
          <InlineCode>breakpoints</InlineCode> is required at the top level —
          all other scales are added via chain methods. Call{' '}
          <InlineCode>.build()</InlineCode> to seal the builder; the result
          attaches a <InlineCode>.manifest</InlineCode> for the plugin.
        </Prose>

        <Heading level={3}>Chain Methods</Heading>
        <TableContainer>
          <thead>
            <tr>
              <Th>Method</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>.addScale(key, createScale)</InlineCode>
              </Td>
             
              <Td>
                Registers a named token scale. The factory receives the current
                theme and returns a value map.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.addColors(colors)</InlineCode>
              </Td>
              
              <Td>
                Registers a color palette. Generates{' '}
                <InlineCode>--color-{'{key}'}</InlineCode> CSS custom
                properties. Validates CSS color values.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.addColorModes(initialMode, modeConfig)</InlineCode>
              </Td>
             
              <Td>
                Adds color-mode variants. The initial mode is emitted on{' '}
                <InlineCode>:root</InlineCode>; all others on{' '}
                <InlineCode>[data-color-mode]</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.createScaleVariables(key)</InlineCode>
              </Td>
           
              <Td>Converts a registered scale to CSS custom properties.</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.updateScale(key, updateFn)</InlineCode>
              </Td>
           
              <Td>
                Receives the current scale values and returns new ones to merge
                in. Non-destructive update.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.build()</InlineCode>
              </Td>
              <Td>
                Returns the finalized theme. Attaches{' '}
                <InlineCode>.manifest</InlineCode> for the plugin.
              </Td>
            </tr>
          </tbody>
        </TableContainer>

        <Heading level={3}>Module Augmentation</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          After calling <InlineCode>.build()</InlineCode>, augment the{' '}
          <InlineCode>Theme</InlineCode> interface so every builder chain method
          receives your token types automatically.
        </Prose>
        <SyntaxBlock language="typescript">
          {`
import { createTheme } from '@animus-ui/system';

const theme = createTheme({ breakpoints: ['sm', 'md', 'lg'] })
  .addScale('space', () => ({ 0: '0px', 4: '4px', 8: '8px', 16: '16px' }))
  .addColors({ text: '#f0ede8', bg: '#141210' })
  .addColorModes('dark', {
    dark:  { text: '#f0ede8', bg: '#141210' },
    light: { text: '#1a1714', bg: '#f5f2ed' },
  })
  .build();

export type MyTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}
        `.trim()}
        </SyntaxBlock>
      </Stack>

      {/* createSystem() */}
      <Stack gap={24}>
        <Heading level={2}>createSystem()</Heading>
        <Stack gap={8}>
          <Label>signature</Label>
          <Mono fontSize={13} color="code-text">
            {'createSystem(): SystemBuilder'}
          </Mono>
        </Stack>
        <Prose fontSize={14} lineHeight="relaxed">
          Creates a design system instance. The builder is evaluated once in a
          subprocess at build time — zero runtime cost. Returns a{' '}
          <InlineCode>SystemInstance</InlineCode> containing the{' '}
          <InlineCode>Animus</InlineCode> builder and a{' '}
          <InlineCode>serialize()</InlineCode> function.
        </Prose>

        <Heading level={3}>SystemBuilder Chain</Heading>
        <TableContainer>
          <thead>
            <tr>
              <Th>Method</Th>
              <Th>Signature</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>.withProperties(cb)</InlineCode>
              </Td>
              <Td>
                <InlineCode>
                  {'(cb: (PropertyBuilder) => { propRegistry, groupRegistry })'}
                </InlineCode>
              </Td>
              <Td>
                Registers the property groups available on every component.{' '}
                <InlineCode>cb</InlineCode> receives a{' '}
                <InlineCode>PropertyBuilder</InlineCode> and must return{' '}
                <InlineCode>{'{ propRegistry, groupRegistry }'}</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.withGlobalStyles(styles)</InlineCode>
              </Td>
              <Td>
                <InlineCode>
                  {
                    '({ reset?: Record<selector, css>, global?: Record<selector, css> })'
                  }
                </InlineCode>
              </Td>
              <Td>
                Injects global CSS. <InlineCode>reset</InlineCode> and{' '}
                <InlineCode>global</InlineCode> are both selector-to-CSS maps.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.build()</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Returns a <InlineCode>SystemInstance</InlineCode> — the{' '}
                <InlineCode>Animus</InlineCode> builder object plus{' '}
                <InlineCode>serialize()</InlineCode>.
              </Td>
            </tr>
          </tbody>
        </TableContainer>

        <Heading level={3}>PropertyBuilder</Heading>
        <TableContainer>
          <thead>
            <tr>
              <Th>Method</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>.addGroup(name, config)</InlineCode>
              </Td>
              <Td>
                Registers a named group of style props. Groups are enabled
                per-component via <InlineCode>.groups()</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.build()</InlineCode>
              </Td>
              <Td>
                Returns{' '}
                <InlineCode>{'{ propRegistry, groupRegistry }'}</InlineCode> to
                the system.
              </Td>
            </tr>
          </tbody>
        </TableContainer>

        <SyntaxBlock language="typescript">
          {`
import { createSystem } from '@animus-ui/system';
import { space, color, typography, flex } from '@animus-ui/system/groups';

export const ds = createSystem()
  .withProperties((props) =>
    props
      .addGroup('space', space)
      .addGroup('text', typography)
      .addGroup('arrange', { ...flex })
      .addGroup('surface', { ...color })
      .build()
  )
  .withGlobalStyles({
    reset: { '*': { boxSizing: 'border-box' } },
    global: { 'html, body': { margin: 0, padding: 0 } },
  })
  .build();
        `.trim()}
        </SyntaxBlock>
      </Stack>

      {/* Builder Chain */}
      <Stack gap={24}>
        <Heading level={2}>Builder Chain</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Every component is built by chaining methods on the{' '}
          <InlineCode>Animus</InlineCode> builder returned from{' '}
          <InlineCode>createSystem().build()</InlineCode>. Each style method
          maps to a CSS <InlineCode>@layer</InlineCode>, giving deterministic
          cascade order regardless of import sequence.
        </Prose>

        <TableContainer>
          <thead>
            <tr>
              <Th>Method</Th>
              <Th>Layer</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>.styles(config)</InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer base</InlineCode>
              </Td>
              <Td>Static base styles. Token values are accepted inline.</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>
                  {'.variant({ prop?, defaultVariant?, base?, variants })'}
                </InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer variants</InlineCode>
              </Td>
              <Td>
                Maps a prop to a set of style variants.{' '}
                <InlineCode>prop</InlineCode> defaults to{' '}
                <InlineCode>'variant'</InlineCode>. Each key in{' '}
                <InlineCode>variants</InlineCode> becomes a valid prop value.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.compound(condition, styles)</InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer compounds</InlineCode>
              </Td>
              <Td>
                Two arguments. <InlineCode>condition</InlineCode> is{' '}
                <InlineCode>{'Record<string, value | value[]>'}</InlineCode>.
                Applies styles when all conditions are simultaneously met.
                Condition values may be arrays to match any of several values.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>{'.states(config)'}</InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer states</InlineCode>
              </Td>
              <Td>
                <InlineCode>{'Record<name, CSS>'}</InlineCode>. Pseudo-class and
                attribute states (e.g. <InlineCode>hover</InlineCode>,{' '}
                <InlineCode>focus</InlineCode>,{' '}
                <InlineCode>disabled</InlineCode>).
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>{'.groups(config)'}</InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer system</InlineCode>
              </Td>
              <Td>
                <InlineCode>{'Record<name, true>'}</InlineCode>. Opts the
                component into registered prop groups, exposing their props at
                the JSX call site.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>{'.props(config)'}</InlineCode>
              </Td>
              <Td>
                <InlineCode>@layer custom</InlineCode>
              </Td>
              <Td>
                <InlineCode>
                  {
                    'Record<name, { property, scale?, transform?, negative?, variable? }>'
                  }
                </InlineCode>
                . Defines runtime CSS custom properties set via inline style.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.asElement(tag)</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Seals the chain. Returns a typed React component backed by the
                given HTML element tag. Exposes{' '}
                <InlineCode>.extend()</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.asComponent(Component)</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Seals the chain. Wraps an existing React component, merging
                extracted styles with its own props. Does NOT activate group
                props. Exposes <InlineCode>.extend()</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.asClass()</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Seals the chain. Returns a{' '}
                <InlineCode>{'(props?) => string'}</InlineCode> class resolver
                instead of a React component.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.build()</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Seals the chain. Returns a parser function with an{' '}
                <InlineCode>.extend()</InlineCode> method.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>.extend()</InlineCode>
              </Td>
              <Td>—</Td>
              <Td>
                Opens a new builder chain from a sealed component as{' '}
                <InlineCode>AnimusExtended</InlineCode>. Merges styles, groups,
                and props via <InlineCode>deepMerge</InlineCode>.
              </Td>
            </tr>
          </tbody>
        </TableContainer>

        <Heading level={3}>Example</Heading>
        <SyntaxBlock language="typescript">
          {`
const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    borderRadius: '4px',
    fontFamily: 'mono',
    cursor: 'pointer',
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'primary',
    variants: {
      primary:   { bg: 'primary',   color: 'coal' },
      secondary: { bg: 'secondary', color: 'coal' },
      ghost:     { bg: 'transparent', color: 'text', border: '1px solid' },
    },
  })
  .compound({ intent: 'ghost' }, { letterSpacing: '0.05em' })
  .compound({ intent: ['primary', 'secondary'] }, { fontWeight: 'bold' })
  .states({ hover: { opacity: 0.85 }, disabled: { cursor: 'not-allowed' } })
  .groups({ space: true })
  .asElement('button');
        `.trim()}
        </SyntaxBlock>
      </Stack>

      {/* createTransform() */}
      <Stack gap={24}>
        <Heading level={2}>createTransform()</Heading>
        <Stack gap={8}>
          <Label>signature</Label>
          <Mono fontSize={13} color="code-text">
            {'createTransform(name: string, fn: TransformFn): NamedTransform'}
          </Mono>
        </Stack>
        <Prose fontSize={14} lineHeight="relaxed">
          Registers a named value transform applied during extraction. The
          function runs in the subprocess and the result is written as a static
          CSS value.
        </Prose>

        <TableContainer>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Definition</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>TransformFn</InlineCode>
              </Td>
              <Td>
                <InlineCode>
                  {
                    '(value: string | number, property?: string, props?: AbstractProps) => string | number | CSSObject'
                  }
                </InlineCode>
              </Td>
            </tr>
          </tbody>
        </TableContainer>

        <SyntaxBlock language="typescript">
          {`
import { createTransform } from '@animus-ui/system';

// Usage: fontSize: fluid(16) → clamp(16px, 1.5vw, 24px)
export const fluid = createTransform('fluid', (value) => {
  const min = Number(value);
  const max = Math.round(min * 1.5);
  return \`clamp(\${min}px, \${(min / 16).toFixed(3)}vw * 10, \${max}px)\`;
});

// Register it on a prop:
// props.addGroup('text', { fontSize: { property: 'fontSize', transform: fluid } })
        `.trim()}
        </SyntaxBlock>
      </Stack>

      {/* Prop Groups */}
      <Stack gap={24}>
        <Heading level={2}>Prop Groups</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          <InlineCode>@animus-ui/system/groups</InlineCode> exports 13 pre-built
          property group definitions. These are plain objects you compose freely
          inside <InlineCode>.addGroup()</InlineCode>. Each key in a group
          object is a prop name; its value describes the CSS property, optional
          token scale, and optional transform.
        </Prose>

        <TableContainer>
          <thead>
            <tr>
              <Th>Export</Th>
              <Th>Props</Th>
              <Th>Covers</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>color</InlineCode>
              </Td>
              <Td>12</Td>
              <Td>
                color, background-color, opacity, fill, stroke and variants
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>border</InlineCode>
              </Td>
              <Td>23+</Td>
              <Td>
                border, border-radius, border-color, border-style, outline and
                shorthands
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>flex</InlineCode>
              </Td>
              <Td>16+</Td>
              <Td>
                flex, flex-direction, align-items, justify-content, flex-wrap,
                order, gap and shorthands
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>grid</InlineCode>
              </Td>
              <Td>21+</Td>
              <Td>
                grid-template-columns/rows, grid-column/row, gap, place-items
                and shorthands
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>background</InlineCode>
              </Td>
              <Td>6+</Td>
              <Td>
                background, background-image, background-size,
                background-position, background-repeat
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>positioning</InlineCode>
              </Td>
              <Td>8</Td>
              <Td>position, top, right, bottom, left, z-index, inset</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>shadows</InlineCode>
              </Td>
              <Td>3</Td>
              <Td>box-shadow, text-shadow, drop-shadow</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>layout</InlineCode>
              </Td>
              <Td>20+</Td>
              <Td>
                width, height, min/max-width, min/max-height, overflow, display,
                aspect-ratio and shorthands
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>typography</InlineCode>
              </Td>
              <Td>9+</Td>
              <Td>
                font-family, font-size, font-weight, line-height,
                letter-spacing, text-transform, text-align
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>space</InlineCode>
              </Td>
              <Td>14</Td>
              <Td>
                margin, padding, gap shorthand props (m, p, mx, my, px, py,
                etc.)
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>transitions</InlineCode>
              </Td>
              <Td>3</Td>
              <Td>transition, transition-property, transition-duration</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>mode</InlineCode>
              </Td>
              <Td>1</Td>
              <Td>color-scheme / color-mode switching prop</Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>vars</InlineCode>
              </Td>
              <Td>1</Td>
              <Td>Arbitrary CSS custom property passthrough</Td>
            </tr>
          </tbody>
        </TableContainer>

        <Heading level={3}>Composing Groups</Heading>
        <Prose fontSize={14} lineHeight="relaxed">
          Spread multiple raw groups to create purpose-built supergroups.
        </Prose>
        <SyntaxBlock language="typescript">
          {`
import { color, border, shadows, background } from '@animus-ui/system/groups';

props.addGroup('surface', {
  ...color,
  ...border,
  ...shadows,
  ...background,
})
        `.trim()}
        </SyntaxBlock>
      </Stack>

      {/* Vite Plugin */}
      <Stack gap={24}>
        <Heading level={2}>Vite Plugin</Heading>
        <Stack gap={8}>
          <Label>signature</Label>
          <Mono fontSize={13} color="code-text">
            {'animusExtract(options: AnimusExtractOptions): Plugin'}
          </Mono>
        </Stack>
        <Prose fontSize={14} lineHeight="relaxed">
          Import from <InlineCode>@animus-ui/vite-plugin</InlineCode> and add to
          your Vite config. The plugin statically evaluates the system module in
          a subprocess, extracts all component styles, and emits a single atomic
          CSS bundle — no runtime style injection.
        </Prose>

        <SyntaxBlock language="typescript">
          {`
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({ system: './src/ds.ts' }),
  ],
});
        `.trim()}
        </SyntaxBlock>

        <Heading level={3}>Options</Heading>
        <TableContainer>
          <thead>
            <tr>
              <Th>Option</Th>
              <Th>Type</Th>
              <Th>Required</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <InlineCode>system</InlineCode>
              </Td>
              <Td>
                <InlineCode>string</InlineCode>
              </Td>
              <Td>Yes</Td>
              <Td>
                Path to the module exporting your system instance. Resolved
                relative to the Vite project root.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>include</InlineCode>
              </Td>
              <Td>
                <InlineCode>string[]</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Glob patterns for files to include in the transform pass.
                Defaults to all <InlineCode>.tsx</InlineCode> and{' '}
                <InlineCode>.ts</InlineCode> files in the project.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>exclude</InlineCode>
              </Td>
              <Td>
                <InlineCode>string[]</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Glob patterns for files to exclude from the transform pass.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>packagePatterns</InlineCode>
              </Td>
              <Td>
                <InlineCode>string[]</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Additional <InlineCode>node_modules</InlineCode> package glob
                patterns to include in the extraction transform. Useful for
                component library consumers.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>strict</InlineCode>
              </Td>
              <Td>
                <InlineCode>boolean</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Throws a build error if any dynamic (non-static) style value is
                encountered.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>verbose</InlineCode>
              </Td>
              <Td>
                <InlineCode>boolean</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Logs extraction diagnostics per file during build. Useful for
                debugging missing styles.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>targets</InlineCode>
              </Td>
              <Td>
                <InlineCode>string[]</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Browser targets passed to Lightning CSS for transpilation during
                minification.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>minify</InlineCode>
              </Td>
              <Td>
                <InlineCode>boolean</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Runs the output CSS through Lightning CSS for minification.
                Defaults to <InlineCode>true</InlineCode> in production builds.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>prefix</InlineCode>
              </Td>
              <Td>
                <InlineCode>string</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Class name prefix applied to all generated classes. Defaults to{' '}
                <InlineCode>animus</InlineCode>.
              </Td>
            </tr>
            <tr>
              <Td>
                <InlineCode>layers</InlineCode>
              </Td>
              <Td>
                <InlineCode>string[]</InlineCode>
              </Td>
              <Td>No</Td>
              <Td>
                Override the default ordered <InlineCode>@layer</InlineCode>{' '}
                declaration list emitted at the top of the CSS output.
              </Td>
            </tr>
          </tbody>
        </TableContainer>
      </Stack>
    </Stack>
  );
}
