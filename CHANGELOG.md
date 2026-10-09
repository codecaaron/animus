# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## Unreleased

**Variant CSS is no longer dropped for components passed as values.**
Production builds keep only the variant and state options a component's
JSX renders write. A component that also reached JSX another way lost the
CSS for options written there: an alias such as `const B = R` or
`const B = Object.assign(R, …)` with `<B size="lg" />`, a component passed
to a function (`pick(R)`), as a prop (`as={R}`), in an object or array, or
as a default export. An alias declared at the top of the module that renders
it is now followed, so `<B size="lg" />` keeps exactly `lg` for `R`, and
`<B p={8} />` gets `R`'s static utility class. Any other value use of a
component, including an exported alias or one declared inside a function,
keeps every variant and state option it declares, and a runtime slot for
each custom prop, as a `{...props}` spread already does.

**System warnings print once per loaded system.** A registration that is
dropped as invalid, and the other diagnostics a system carries, used to
repeat on every analysis and hot update. They now print when the system
loads and again only after it reloads; under `strict` an error still fails
every analysis until it is fixed.

**Contextual variables can take the variable prefix.** With `prefix` set,
`prefixContextualVars: true` gives each contextual variable its prefixed
name everywhere Animus emits it, while authors keep writing the declared
name: scale values, `{scale.name}` references, `var()` reads including
fallbacks, style-object keys such as `'--tone': value`, keyframes, global
styles, the values of declaration-scale records, transition lists, style
queries, component custom props, `currentVar`, the runtime scale map and the
runtime keyword classes. The exact prefixed spelling still resolves.
Undeclared custom properties and text inside strings and `url()` are left
alone, and so are values a transform returns and strings set at runtime:
write the prefixed name there. A final name that would collide, inside the
runtime's `--animus-` variables or with a theme variable of the same
spelling, reports `animus.prefix.name-conflict`. So `prefix: 'animus'` cannot be used with `prefixContextualVars`: every contextual variable would land among those variables, and each one reports the error. The option is off by
default; a project with a prefix and contextual variables that has not
turned it on reports `animus.prefix.contextual-vars-unprefixed`.

**`asset()` references are recognised where a browser loads them.** A
placeholder is an asset reference when it is the argument of `url()` in any
letter case, quoted or bare, or a quoted string that opens an `image-set()`
or `-webkit-image-set()` candidate, such as
`image-set("${asset('./hero.png')}" 1x)`. Placeholder text anywhere else, such
as `content: "animus-asset:note"`, is left as written. Before, any such text
in component CSS was taken for an asset: a `strict` build failed on it as an
unresolvable specifier, and otherwise it was rewritten. Placeholder text still
inside a `url()` or `image-set()` after substitution is reported as
`animus.asset.unsubstituted-placeholder`, which fails `strict` builds.

**Custom-property diagnostics find more transitions and cost less.** A
transitioned custom property is now recognised after a leading comment
(`transition: /* fade */ --tone 0.2s`) and after its duration
(`transition: 1s --tone`). A project without `@property` registrations no
longer parses its stylesheets for the self-reference check unless the text
can hold one, and the unit fallback runs once per analysis instead of twice.

**`asset()` resolves in theme scale values.** An `asset()` call inside a
`createTheme` scale value, such as
``images: { rock: `url("${asset('@acme/media/rock.jpg')}")` }``, now
resolves to the same hashed URL the same call gets in global styles, and its
file is copied or emitted and watched the same way. Before, the theme's
variable CSS and the component CSS skipped asset substitution, so the built
CSS shipped `url(animus-asset:…)` unchanged. Every stylesheet now passes
through one substitution step, in the Vite plugin and in the shared session
behind the Next.js plugin and the CLI. A placeholder that still reaches
emitted CSS is reported as `animus.asset.unsubstituted-placeholder`, which
fails `strict` builds.

**Custom properties report what will not behave as written.** Extraction
now warns about a custom property whose value resolves to `var()` of
itself, for example a component prop given its own property's contextual
name (`animus.property.self-reference`). When the theme registers at least
one `@property`, it also reports:

- a `var(--x, fallback)` read of a property registered with an initial
  value, whose fallback never applies (`animus.property.fallback-suppressed`,
  info). It is a warning when the fallback starts a chain of further
  `var()` reads (`animus.property.fallback-chain-suppressed`);
- a declared contextual variable set in keyframes, or named as the property
  of a transition, while it is unregistered or registered with the universal
  syntax `*`, so it does not interpolate
  (`animus.property.unregistered-animation`, info). It is a warning when
  `allow-discrete` shows interpolation was intended
  (`animus.property.discrete-animation`).

Info diagnostics print only with `verbose`. None of these checks changes the
emitted CSS.

**CSS-wide keywords passed at runtime now mean what they mean when written
statically.** A runtime value of `initial`, `inherit`, `unset`, `revert` or
`revert-layer` used to reach the property through the prop's inline CSS
variable, so the keyword acted on that variable. For example, a runtime
`inherit` picked up the parent's runtime variable instead of the parent's
padding. A system or component prop that a JSX attribute passes a runtime
value, such as `<Box p={pad} />`, now gets one class per keyword, at the base
and at each breakpoint, holding the direct declaration, and a runtime
keyword selects it. A responsive value selects the keyword class for each
keyword entry, and its other entries still use the inline variable. A prop
that receives runtime values only through a spread, forwarding or an alias
gets no keyword classes and keeps the old behaviour. Props bound to a
declaration scale get none either, because they accept only the scale's
keys. A scale key spelled like a keyword, such as `inherit` in a `space`
scale, keeps its scale value at runtime, as it does when written statically.

**A prop's `currentVar` now carries runtime values to descendants.** A
prop with `currentVar`, such as `bg` writing `--current-bg`, set that variable
only when its value was static. A value that arrived at runtime reached the
property through the inline variable but left `currentVar` alone, so children
reading it saw an ancestor's or the initial value. The runtime slot now
writes `currentVar` too, in the same layer as a static write. As with a
static write, a value that reads the variable itself, such as `current-bg`
or `{colors.current-bg/85}`, does not write it, because that would make it
cyclic. Such a value takes a second slot class that leaves `currentVar`
alone, so each prop with `currentVar` emits two slot classes at the base and
at each breakpoint. Props without `currentVar` emit the same CSS as before.
The check now also recognises a read with a fallback, such as
`var(--current-bg, red)`, which a static write used to copy into
`currentVar`, making it cyclic, and a read in any case or spacing, such as
`VAR( --current-bg )`.

**`asset()` in a scale value now loads when a prop selects it at runtime.**
A theme scale value such as ``images: { rock: `url("${asset('@acme/media/rock.jpg')}")` }``
reached the browser unresolved when a prop picked `rock` at runtime: the
runtime prop configs carried the raw `url(animus-asset:…)` placeholder into
an inline style, which loaded nothing. Extraction now replaces such a value
in every runtime config with `var(--animus-asset-<hash>)` and declares that
variable on `:root` in the global stylesheet, where the same substitution as
every other stylesheet resolves the URL, emits the file and watches it. This
covers system props, component props and declaration scales, in the Vite
plugin, the Next.js plugin and the CLI. A placeholder still found in the
generated runtime modules is reported as
`animus.asset.unsubstituted-placeholder`, which fails `strict` builds. A
runtime transform bound to such a prop now receives the `var()` reference
rather than the URL.

**Selecting the removed v1 engine explains itself.** Setting `engine: 'v1'`
or `ANIMUS_ENGINE=v1` still fails, and the error now says that the v1
extraction engine is no longer supported, that v2 is the only engine, and to
remove the `engine` option and unset `ANIMUS_ENGINE`. It no longer cites an
internal change name.

**Verbose timing drops the Rust phase lines that were always zero (breaking for importers of `formatRustTimingWaterfall`).** The
engine stopped reporting per-phase Rust timings when v1 was removed, so
verbose output from the Vite plugin and the shared session printed eleven
`0ms` lines under each analysis. Those lines are gone, and every other
timing line is unchanged. `formatRustTimingWaterfall` is no longer exported
from `@animus-ui/extract/pipeline`, and nothing replaces it.

**The CLI selects the trace tier with `--trace`.** `animus build`, `watch`
and `print-config` accept `--trace`, which sets `verbose: 'trace'` as the
config file already could. A plain `--verbose` still overrides a config
`verbose: 'trace'`. The CLI has no per-item lines yet, so `--trace` logs what
`--verbose` logs.

**Invalid `@property` registrations are reported instead of breaking the
build.** A contextual-variable registration that browsers would ignore is no
longer emitted. That covers:

- an unknown syntax component;
- a syntax other than `*` with no initial value;
- an initial value that depends on context (`1em`, a container unit, `var()`);
- an initial value the syntax does not accept.

It is reported as `animus.theme.invalid-property-registration`, which fails
`strict` builds. Vite's production CSS minify used to fail on some of these
rules.

**A contextual-variable registration that omits `inherits` now inherits.**
It registers with `inherits: true`, the documented default, instead of
emitting `inherits: undefined`, which browsers reject. Extending themes
compares registrations the same way, so such a registration no longer counts
as divergent from one that says `inherits: true`.

**A `const` style config reports what it could not carry.** When
`.styles(config)` or another stage receives a same-file `const` object, a
property the extractor cannot evaluate statically, such as `color: someVar`,
is now reported as a `[skip]` warning, as it is for an inline object.
Previously it was dropped silently. That holds for `.styles()`, variant
options, a compound's styles and a `.props()` config, and a nested loss
names its path, such as `_hover.color`.

**Compose families behind TypeScript syntax are recognised.** A
`compose(...)` or `composeWithContext(...)` call wrapped in `as`,
`satisfies`, `!`, parentheses, a `<Type>` assertion or an instantiation
expression is now a family, including as a default export, so its slots
keep their styles and its shared variants reach them. Previously the family
was missed and its slots' styles could be pruned. A file that still uses
`compose` where extraction does not recognise a family, such as a call
inside a function or a call through another local name
(`import { compose as c }`), now keeps that import; before, the import was
removed and that call failed at runtime.

**Chains behind TypeScript syntax extract like bare chains.** A chain
declaration wrapped in `as`, `satisfies`, `!`, parentheses, a `<Type>`
assertion or an instantiation expression, such as
`export const Root = ds.variant({ … }).asElement('div') as typeof Base`, is
now extracted with the same class and CSS as the bare chain. Before, it was
left untransformed, and a compose family using it as a slot lost that
slot's styles and shared variants. `asComponent(<Type>Link)` and
`asComponent(Link<Type>)` now extract as `asComponent(Link)` does, and a
wrapped default-exported chain reports `animus.chain.unsupported-default-export`
as the bare one does.

**Family member tags resolve through the file's own imports.** A tag such
as `<Card.Body p={8} />` now finds its family through the imports of the
file it is written in, so it gets its utility classes however the family
arrives: under another name (`import { Card as Panel }`), through
re-exports and barrels (`export * from`, or an imported name exported
again), as a default import, or through a namespace import
(`<ui.Card.Body />`). An import from a package the analysis cannot resolve
still finds the family when exactly one family has that name; that match
is by name alone, so it can pick a family the package does not export. Before,
member tags were matched by the family's declared name across the whole
project: an aliased, default or namespace import missed its slots, and two
modules exporting families with the same name could take each other's tags.
The manifest's `crossFile.memberBindings`
changes shape to match. It now maps each consuming file to the member tags
written there and the component each one renders, for example
`{ "app.tsx": { "Panel.Body": "card.tsx::Body" } }`.

**System props that lose their component are reported.** When a tag such
as `<Button marginInlineStart={8} />` is imported from an analyzed module
but resolves to no extracted component, for example a function-component
wrapper, `export const Button = ButtonRecipe` or
`Object.assign(ButtonRecipe, …)`, its system props get no static utility
classes and fall back to dynamic slots. The build now warns with
`animus.usage.unattributed-system-props`, naming the file, the tag, the
declaration it resolved to and the props. It is a warning, so `strict`
builds still pass. Tags imported from packages outside the analysis, such
as a UI library's components, never trigger it. It names only props the
component reached takes as system props, never its variant, state or custom
props. It does not yet see a wrapper reached through `export *`, a render
through `createElement` or a member tag, an `export default` wrapper, or
props destructured inside the function body, so those can still lose
classes without a warning.

**Finite declaration scales style several properties through one prop.**
`createTheme().addDeclarationScale({ name, values })` registers named keys
whose values are complete, flat records of CSS declarations. Bind a scale
with `{ kind: 'declarations', scale, members }` in a system prop or a
component's `.props()` config. Literal and runtime-selected keys use the
same records, including responsive values. Token references and each
member's units are resolved before delivery. Declaration records stay
separate from scalar scales and executable transforms.

System declaration props share member variables, so a nested consumer
without a base binding can adopt its ancestor's values. Component member
variables belong to the declaring component; extensions inherit that
identity until redeclaration. Unknown keys drop the whole prop value.
Within one layer, a same-condition atomic rule wins over a declaration;
a responsive declaration can win over a base atomic rule. The custom layer
outranks the system layer. Hot updates remove obsolete member variables
from mounted resolver-driven nodes.

**Custom atomic utilities have their own class namespace.** Generated
custom utility names change from `animus-u-<hash>` to
`animus-uc-<hash>`; system utility names remain `animus-u-<hash>`.
Identical CSS can now be reused within each layer without giving system
consumers custom-layer precedence. Consumers that match generated class
names must update those selectors. Rule order is unchanged.

**Watch updates preserve distinct concurrent batches.** A caller waiting
for another analysis now ingests its own changed or removed files before
acknowledging completion. Empty joins remain no-ops.

**Relative imports written with their emitted extension resolve.** An
import such as `'./signals.js'` between analyzed source files now resolves to
`signals.ts` (or `.tsx`, `.jsx`; `.jsx` to `.tsx`, `.mjs` to `.mts`, `.cjs`
to `.cts`), as TypeScript's NodeNext and bundler resolution do. A `compose()`
slot or `.extend()` parent imported this way no longer fails with
`compose.unresolvable-slot` or "could not resolve parent component", and a
component re-exported under another name through such a path keeps its
consumers' static utility classes. A real `.js` file of the same name still
wins.

**A `{...props}` spread keeps the variant and state options it can
reach.** A component rendered through a spread, such as a wrapper that
forwards its props, previously counted as using only each variant's default,
so production builds pruned options the wrapper's callers selected and those
options rendered unstyled. Variant and state options a spread can deliver are
now kept; an attribute written after the spread still counts as its literal
value. A `createElement` call whose props argument is an expression, or an
object with a spread or computed key, is treated the same way; one with no
props, `null`, or an object literal of static keys settles exactly those keys.
System and custom props keep their existing runtime handling.

**Logging has a trace tier above `verbose`.** `verbose: 'trace'` (or
`ANIMUS_DEBUG=trace`) prints one line per item: each pruned variant or state
option, each transformed file, and each per-file HMR event, skip or
invalidation. `verbose: true` (or `ANIMUS_DEBUG=1`) now keeps to phase
checkpoints, summaries and timing. The per-option `pruned` lines no longer
print by default; component elimination warnings still always print. Every
host accepts `'trace'`; only the Vite plugin has per-item lines today.

**Hex colors and quoted strings no longer gain `px`.** The unit fallback
appended `px` to a digit run that ended a word, so `#b1b1b7` became
`#b1b1b7px` and `"ss01"` became `"ss01px"`. A number now gains `px` only
where it starts a value token (so `U+0025-00FF` is left alone too), text
inside quotes is left alone including escaped quotes, and custom property
values are never rewritten, whatever the case of the property name.

**`asChild` no longer triggers React 19's `element.ref` warning.** The
child's ref is read from its props on React 19 and from the element on React
18, and it is still composed with the parent's ref.

**Variable prefixes also rename `@property` registrations.** A configured
prefix now applies consistently to registration names, declarations and
`var()` references, preserving registered inheritance and initial values.

**Invalid transform results are now rejected instead of silently
stringified (headline behavior change).** A prop `transform` must return a
`string` or a finite `number`. Every other shape — object, array, function,
`null`, `undefined`, boolean, symbol, bigint, `NaN`, `±Infinity` — is now
rejected on both
resolution paths (a build failure statically, a dropped value dynamically)
instead of being coerced with `String(...)`:

- **Static (build).** Extraction emits no declaration for the offending prop
  and records an error diagnostic; the Vite and Next plugins fail the build,
  listing every occurrence:

  ```
  [animus] <component> (<file>): transform '<name>' returned <shape> for prop '<prop>' — transforms must return a string or finite number; rule-level styling ships as declaration scales (see composite-style-scales)
  ```

- **Dynamic (browser).** The whole prop value is dropped atomically — every
  breakpoint of a responsive value, no slot class and no variable writes —
  with a once-per-class/prop dev warning. Production drops quietly.
- **Throwing transforms (build)** keep their existing raw-value fallback, but
  the fallback is now reported as a warning diagnostic instead of being silent.
- **Throwing transforms (browser).** A named or inline transform that throws
  for a runtime value no longer escapes into React and unmounts the tree. The
  whole prop value is dropped atomically, as for an invalid result; other
  props and the authored `className` and `style` are untouched, and a later
  valid value applies normally. Development warns once per component, prop
  and value, naming the transform (or `inline transform`), the value and the
  error. Production drops quietly.

Previously invalid results reached the stylesheet as text like
`[object Object]`: invalid CSS, an unstyled element, and no diagnostic on
either path. Valid results are untouched — emitted CSS and variable values
are byte-identical.

_Migration._ This includes objects whose `toString` yields valid CSS text —
boxed primitives, Dates, RegExps, and custom CSS-value classes — which the
old coercion silently accepted, and `bigint` results (previously stringified
like `10n` → `"10"`): return the plain string or number instead. Object
returns were live behavior in the legacy Emotion runtime
(`legacy/core`), where the returned object merged into the rule. The
extraction rewrite dropped that behavior at build time and only the type
survived, so a migrated object-returning transform has been producing silent
garbage; it now fails loudly. Rewrite such transforms to return a single CSS
value — rule-level styling (one prop writing several declarations) arrives as
declaration scales in an upcoming release. The public type
surface is unchanged in this release: `TransformFn` and
`CustomPropConfig.transform` keep the wide `string | number | CSSObject`
union, now documented as deprecated on the `CSSObject` arm; narrowing lands
in the next breaking release. Rollback is a version revert — there is no
config or data migration.

**Unsupported Animus declarations are classified; `strict` can fail on
them.** When extraction proves a declaration comes from `@animus-ui/system`
and cannot extract it, the diagnostic now carries a stable code, the file
and binding, the reason and a supported rewrite:

| Code                                           | Declaration                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animus.variant.unsupported-config-reference`  | `.variant(AXIS)` passing the whole config through an identifier                                                                                                         |
| `animus.chain.stage-evaluation-failed`         | a stage argument extraction cannot evaluate, or a `.props()` config that is not the documented shape                                                                    |
| `animus.chain.unsupported-method`              | an unknown method in a builder chain                                                                                                                                    |
| `animus.chain.unsupported-terminal-target`     | an `.asComponent()` target with no static identifier or member path                                                                                                     |
| `animus.chain.unsupported-default-export`      | a builder chain bound by `export default` (reported at its source position)                                                                                             |
| `animus.chain.unsupported-namespace-root`      | a chain built from `ns.ds` through `import * as ns`                                                                                                                     |
| `animus.extension.unsupported-member-parent`   | `.extend()` from a member of an exported object                                                                                                                         |
| `animus.extension.unsupported-arguments`       | `.extend()` called with arguments                                                                                                                                       |
| `animus.props.unsupported-config`              | a `.props()` custom prop whose config is dropped — built with a spread or unresolvable — directly or inside a const config                                              |
| `animus.props.unsupported-transform-reference` | a `.props()` custom prop that loses its `transform` callback: an unsupported reference, call or conditional, or any callback reaching `.props()` through a const config |
| `animus.transform.configured-rejected`         | a system-configured transform rejected before registration, so it is never delivered to the runtime                                                                     |

What stays supported: a `transform` written inside the `.props()` object
literal as an inline function or as a reference to a const arrow or function
expression, a never-reassigned function declaration, a const alias of one of
these, or a const created by `createTransform` imported from
`@animus-ui/system`, and a named transform string such as `transform:
'size'`. `transform: undefined` and `transform: void 0` mean "no transform"
and are not reported. Moving a working inline callback into a const config
is the case that now reports a lost callback.

With `strict` omitted or `false` (the default) these stay warnings and the
build succeeds; a rejected configured transform still falls back to the raw
value. With explicit `strict: true` (`--strict` in the CLI) they fail the
build together, in Vite, Next, unplugin and the CLI, and a development
server shows the error without publishing the rejected analysis and recovers
on the next valid edit.

Outside the classified set nothing changes. Declarations whose Animus
origin extraction cannot prove — another library's builder, a system
outside the analyzed files, or a system reached through an import-then-export
or `export *` barrel — retain their previous behavior: existing uncoded
warnings remain, while unproven default-exported and namespace-rooted chains
still produce no diagnostic. Valid dynamic values,
runtime fallbacks, raw values on unscaled or `strict: false` props, pruning,
runtime transform exceptions and the build-time transform-throw raw fallback
are unaffected by `strict`. Existing hard errors are unchanged.
`animus.extension.unsupported-member-parent` was previously a warning even
under `strict`, and `animus.compose.unresolvable-slot` keeps its existing
`error` severity.

**Strict-scale token misses are omitted instead of applied raw.** A prop
bound to a scale is strict unless it declares `strict: false`. On a strict,
populated scale, a value that names no token — `p={13}`, `m={-13}`,
`p="lg"`, `color="banana"`, `color="#fff"`, `p="2.5rem"` — previously reached
the stylesheet as a raw
value such as `padding: 13px`. Both paths now omit that prop's styling,
every responsive entry included, and keep the authored value in a warning:

- **Static (build).** No declaration or class is emitted, so no cached class
  can stand in for the runtime decision. The diagnostic
  `animus.props.strict-token-miss` names the file, component, prop and
  authored value. It is a warning with `strict` omitted or `false` and fails
  the build under explicit `strict: true`, like the classified declarations
  below.
- **Dynamic (browser).** The whole prop value is dropped atomically; other
  props and the authored `className` and `style` stay, and a later valid value
  applies normally. Development warns once per component, prop and value;
  production drops quietly. A miss is decided before any transform runs.

Admitted values keep their meaning: scale keys, declared contextual
variables, admitted negatives (`negative: true` with a positive key; an exact
negative key wins), zero, CSS-wide keywords, the keywords the strict type
admits for the property (`auto` for `margin`, `currentColor` for `color`),
container units like `2cqi` or `1e2cqi`, token references, and length or
`calc()` values on size properties. The extractor's keyword list is
generated from the public strict types and checked against them.
Known tokens keep their CSS variable relationships and transform order.
`strict: false`, unscaled and empty-scale props are unchanged.

A custom prop now resolves only through its own component's `.props()`
configuration: two components' equally named custom props no longer share
classes, even when one file renders both with the same value, its usages no
longer also produce a stray system-layer rule (such as `density: compact`),
and a same-named system class or slot never applies to it. A system prop's
static classes are no longer dropped because some component declares an
equally named custom prop with an inline transform. A component rendered through a `{...props}` spread or `createElement`
gets its custom props' runtime configuration, so values forwarded that way
apply.

_Migration._ Use a scale key, or declare the prop `strict: false` to accept
raw values. `.props()` custom props are strict by default, like system props;
the runtime follows the configuration, not TypeScript inference. A named
`scale` typed as a literal (`'space' as const` or a fully `as const` config)
keeps precise token types; a widened one — a bare object literal or a
`satisfies` check — types as loose but is still enforced, so declare it
`strict: false` if it should keep raw values. The system
package now serializes `strict: true` for strict scaled props; pair it with
the matching extractor, because an older system package's configuration is
read as loose.

**Configured transforms are bound to the callable you configured, not to a
name.** A system prop now resolves through the transform it was configured
with, during extraction and at runtime alike:

- One callback bound to several props is one definition, shipped once.
- Two different callbacks with the same name stay separate, such as two
  `createTransform('unit', ...)` calls or your own `size` beside the
  built-in one. Building such a system previously failed with a
  `registered by both props` error.
- A `createTransform()` declared in a project file no longer replaces a
  configured transform with the same name. Previously it won in static CSS
  only, depending on file order, while the browser kept the configured one.
- A transform named after a standard global, such as `Map`, no longer
  breaks other transforms that use that global at build time.

Error and warning messages still name transforms by their readable name.
A component `.props()` entry written as `transform: 'size'` binds the one
configured transform with that name; when several share it, the prop keeps
its raw value with a warning naming the transform.

_Migration._ To override a built-in transform, bind your transform in the
system configuration (`addProps`/`addGroup`); a same-named
`createTransform()` elsewhere in the project has no effect. The system
package now serializes a `transformId` beside each prop's transform name and
keys `toConfig().transforms` and `transformSources` by it; pair it with the
matching extractor.

**Component custom props can reference a local callback.** Instead of
repeating a callback inline, a `.props()` `transform` may now reference one
declared in the same module: a `const` arrow or function expression, a
function declaration that is never reassigned, a `const` alias of one of
these, or a `const` created by `createTransform(...)` imported from
`@animus-ui/system`. Type assertions around the reference, including
`<T>value` in `.ts` files, are allowed. One callback can serve several props
and components. Extraction keeps the reference as written, so the callback
runs in its own module with its closures intact, and a configured transform
with the same readable name never replaces it. Previously the reference was
dropped with an `animus.props.unsupported-transform-reference` warning and
the prop applied raw values. Like an inline callback, a referenced one runs
in the browser for every value the build cannot know.

**Component custom props can reference an imported callback.** The same
callbacks may be imported from another analyzed module: named and default
imports, import aliases, named re-exports through barrels, configured path
aliases and the source of an included package. `createTransform` is
recognized by where it comes from, so a local
`export { createTransform } from '@animus-ui/system'` works too. The
component module keeps its import, so the callback runs in its own module
with its closures and dependencies after bundling, and two modules exporting
the same name stay separate callbacks. In Vite development, editing the
imported module updates its consumers, and a syntax error there holds
publication like one in any other source.

These remain `animus.props.unsupported-transform-reference`, now with the
reason in the message, naming the module where resolution stopped for an
import: a `let` or `var` binding, a reassigned function, any other computed
`const` such as a call to your own factory, a name the module does not
declare, an import from a module outside the analyzed sources (a package
whose source is not discovered, for example) or through `export *`, a circular
re-export, and any callback reaching `.props()` through a const config.

**Extensions keep their parent's custom props.** An extracted
`Parent.extend()…` component used to lose every custom prop of its parent:
the props reached the DOM as attributes and applied no styling. An extension
now inherits each custom prop with its CSS mapping, scale, strictness,
negative values, transform and responsive values, at any depth, whether the
parent is in the same module, imported from another one or from an included
package's root entry. Inherited inline and referenced callbacks are read from
the parent component the extension names, so they keep the parent module's
closures and private bindings. Calling `.props()` on an extension now adds to
the inherited props instead of replacing them all; redeclaring a prop
replaces that one prop, for the extension and its own extensions only. In
Vite and in Next.js webpack and Turbopack development, editing the parent
module, including state private to it, updates every module that extends
it. As with the authored `.extend()` call,
the parent module must initialize before the extending one, and a client
module's parent with callbacks cannot be extended from a server module.

**Known values through component callbacks are extracted.** An inline,
local or imported `.props()` callback used to run in the browser for every
value, literals included. When the callback is self-contained — it uses only
its parameters, standard globals and `btoa`/`atob`, the same rule configured
transforms follow — a literal value such as `<Box wide={10} />` now extracts
to a static class computed by that callback at build time, inherited
callbacks and child overrides included. Values the build cannot know
(dynamic values, spreads, wrappers) still reach the same callback at
runtime. A callback that closes
over module state or imports keeps running in the browser for every value,
with no warning, in every strictness mode. So does a literal whose evaluation reads the host
environment (`globalThis`, `eval`, `Function`, `Date`, `Math.random`,
`console` or locale methods) or does not finish within a fixed budget, a
value that misses a populated scale, and a string result that CSS
post-processing would rewrite, such as `"20"` (which would gain `px`) or
`{space.4}`; a number result extracts with the usual units. Each literal is
evaluated in its own fresh realm, so a callback that reassigns `Math.round`
cannot change another callback's output. `100` and `"100"` get separate
static classes when the callback tells them apart. Static evaluation follows
the build-time policies of configured transforms: a callback that throws for
a literal warns and applies the raw value, and one that returns an object or
another invalid result for a literal fails the build. Both are reported once,
against the component whose `.props()` declares the prop, even when only an
extension renders the literal.

**Callbacks a component can only receive as extracted literals no longer
ship.** A component its module keeps to itself — not exported, used only as a
JSX tag directly inside a host element or fragment, or as the base of an
`.extend()` in that module — no longer carries a `.props()` callback or its
runtime slot for a prop it receives only as literals with extracted classes,
or never receives. A system prop active only on such components loses its
runtime slot, and its configured transform leaves the runtime registry unless
another prop still needs it. Everything else keeps the runtime callback,
including such a component passed to another component as children or inside
an attribute, and a callback whose code reads an import; a parent keeps
delivering a callback an extension still needs, and a module whose imported
callback is no longer referenced stays imported, in place, for its side
effects.

**Transforms may call `btoa` and `atob`.** A configured transform such as
``createTransform('svgUrl', (v) => `url("data:image/svg+xml;base64,${btoa(String(v))}")`)``
was rejected before registration (`animus.transform.configured-rejected`),
so its props fell back to the raw value. `btoa` and `atob` are now allowed
by name: such a transform extracts known values, is delivered to the browser
and to server rendering for runtime values, and a project `createTransform`
using them no longer reports that it was not extracted. The same applies to
the static evaluation and pruning of `.props()` callbacks, except that a
callback whose module declares or imports its own `btoa` or `atob` keeps
calling that one and runs in the browser for every value. A configured
transform whose callback reads a `btoa` or `atob` bound outside it — in its
module, imported, or from an enclosing function — is rejected
(`animus.transform.configured-rejected`, raw value) rather than silently
calling the host's, as is one whose binding extraction cannot locate, such as
a callback built with `new Function`, one in a module that calls `eval`
directly, or one from a system built by an older `@animus-ui/system`; upgrade
`@animus-ui/system` together with the extractor. `btoa` encodes
Latin-1 only, one byte per character up to U+00FF, and throws above it;
encode other text yourself. Throws from either function, including invalid
Base64 for `atob`, follow the existing policies: a known value warns and
applies the raw value, and a runtime value drops that prop's styling. Other
host names, such as `window`, `document`, `fetch`, `TextEncoder`,
`performance` or `queueMicrotask`, are still rejected even where the build
or the browser defines them. Nothing is polyfilled, and CSP or isolation
settings are unchanged.

**Configured transforms are evaluated the way `.props()` callbacks are.**
A system's `createTransform` callbacks now evaluate known values in
isolation, under the same rules as component callbacks:

- **Number and string literals stay apart.** `<Box w={100} />` and
  `<Box w="100" />` used to share one static class, so a callback that tells
  them apart rendered one of them with the other's result, and a runtime
  `"40"` could pick up the class built for `40`. Props bound to a configured
  transform now get typed static keys, both directly and through a `.props()`
  prop that names the transform. Untransformed props are unchanged. Upgrade
  `@animus-ui/system` together with `@animus-ui/extract` and the extraction
  plugin or CLI that consumes it: an older system runtime ignores the
  generated `typedSystemProps` list, so it can apply a number's class to a
  string or miss a string's class.
- **One callback cannot change another's result.** Each literal is evaluated
  in its own fresh realm under a fixed budget. A callback that reassigns
  `Math.round` no longer changes what another callback extracts, whatever
  the file, element or attribute order.
- **A callback that loops in JavaScript no longer hangs the build.** A
  literal whose evaluation keeps running JavaScript stops at a fixed budget
  of interpreter steps and is treated as not evaluable. The budget counts
  JavaScript execution only: it does not limit memory, or the time spent
  inside a single built-in call such as a very large `String.prototype.repeat`,
  which still runs to completion.
- **Known host-environment reads are not baked in.** A literal whose
  evaluation reads one of `globalThis`, `eval`, `Function`, `Date`,
  `Math.random`, `console` or the locale methods used to be baked from the
  build's engine.

  In JSX, and in `staticCss.systemProps` values, such a literal now gets no
  static class. The configured callback computes it in the browser, with no
  warning in any strictness mode. In a style block, variant, state or global
  style there is no runtime path, so the build applies the raw value and
  warns with `animus.transform.static-evaluation-unavailable`. Explicit
  strictness fails the build on it.

- **JSX follows the runtime's result.** The runtime applies a callback's
  string result verbatim and passes a value that misses a populated scale
  through the callback. Extraction used to add units to a numeric-string
  result, resolve token syntax such as `{space.4}` in a result, and apply a
  `strict: false` scale miss raw.

  Such JSX literals now get no static class and render what the runtime
  computes. A `.props()` prop that names a configured transform keeps its
  runtime slot for them, as a `.props()` callback does, unless its component
  is confined to its module and every literal it receives has a class.
  **This changes literal-only uses that relied on extraction's
  normalization.** For example, the built-in `borderShorthand` returns string
  input unchanged, so `<Box border="2px solid {colors.primary}" />` or
  `border="1"` is now applied verbatim and is invalid CSS. That is what the
  same string always did as a runtime value. Write a number, a full CSS
  value or a `var(...)` reference instead.

  Style blocks, variants, states and global styles keep extraction's
  post-processing. Numbers, scale hits, unitless properties and full
  `var()`/`calc()` strings extract as before.

**Configured transforms that close over their module are rejected.** A
system's transform callback is evaluated and delivered to the browser as its
own source text, so it cannot keep the bindings it closes over. A callback
reading a module-level `Math`, an imported `Set` or a `JSON` from an
enclosing function used to run against the standard globals instead, on both
paths. Extraction now locates every configured callback in its module. A
callback shown reading any binding declared outside itself is rejected with
`animus.transform.configured-rejected`: its values apply raw and it is not
delivered.

Callback-local declarations and the standard globals themselves are
unaffected. When the callback cannot be located — a system built by an older
`@animus-ui/system`, a callback built at runtime or bound, or a module that
calls `eval` directly — a callback that reads neither `btoa` nor `atob`
keeps its earlier admission. That admission does not prove the callback
closes over nothing. `btoa`/`atob` callbacks still require their evidence.

**A source the native parser cannot finish no longer publishes a partial
extraction.** A syntax error the parser stops at, such as an unclosed call
in a component module, previously still produced a successful analysis
without that file: in development its CSS and runtime configuration
disappeared while the browser kept running the previous module, and a build
could publish everything else. Such an attempt now publishes nothing, and
while the file stays broken every later edit, including a design-system
module edit, is held as well: development
keeps serving the last successful generation, the plugin warns
`analysis not published: the parser stopped before the end of <file>`, and
Vite reports the syntax error itself. Repairing the file publishes all held
edits together without a restart. A Vite production build, `animus build`
and the first analysis of a Next config fail naming the file — under
Turbopack, fix the file and start Next again — while `animus watch` and a
running Next watcher keep their last-good artifacts and report the failure.
Under Next webpack the failure, at startup or later, is an error of that
compilation and the watch continues, so the repair publishes without a
restart; previously a failure there stopped webpack from watching.
This applies with `strict` omitted, `false` or `true`. Parse diagnostics the
parser recovers from still only warn, and MDX or Svelte preprocessing
failures keep their existing quarantine.

**Peer-range clamps (breaking for consumers on unproven majors).** Host
peer ranges now match the versions our blocking fixtures actually prove:

- `@animus-ui/vite-plugin` peers `vite: ">=8 <9"` (was `>=5.0.0`)
- `@animus-ui/next-plugin` peers `next: ">=15 <16"` (was `>=14.0.0`) —
  Next 16 (Turbopack-default) stays excluded until a blocking fixture
  exercises that exact build mode

Consumers on other majors should stay on earlier plugin releases; a major
is re-admitted when a blocking fixture proves it.

**Packaging fixes** (caught by the new packed-artifact verification lane):

- `@animus-ui/next-plugin` is now CJS-only with a consistent exports map
  (types previously resolved as CJS under the `import` condition)
- `@animus-ui/vite-plugin` now declares a proper `exports` map
- `@animus-ui/extract` ships type declarations for the `./engine-v2`
  subpath and format-consistent `./pipeline` entries

## 0.1.0 (2026-05-11)

First release of the new Animus package architecture:

- `@animus-ui/properties` — prop registry and style-prop definitions
- `@animus-ui/system` — component builder, theme construction, runtime
- `@animus-ui/extract` — Rust-based static CSS extraction pipeline (NAPI)
- `@animus-ui/vite-plugin` — Vite integration for static extraction
- `@animus-ui/next-plugin` — Next.js integration for static extraction

Supersedes the 2022 `@animus-ui/core` / `theming` / `components` line (archived under `legacy/`).

## [0.1.1-beta.1](https://github.com/codecaaron/animus/compare/v0.1.1-beta.0...v0.1.1-beta.1) (2022-01-09)

**Note:** Version bump only for package root

## 0.1.1-beta.0 (2022-01-09)

**Note:** Version bump only for package root
