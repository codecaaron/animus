# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## Unreleased

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
