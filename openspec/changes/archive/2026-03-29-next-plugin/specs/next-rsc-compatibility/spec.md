## ADDED Requirements

### Requirement: Server component compatibility for fully-extracted components
Components created by `createComponent` that have no dynamic runtime behavior SHALL be usable as React Server Components without a `"use client"` directive.

#### Scenario: Static component in server context
- **WHEN** a component is fully extracted (no system props at JSX site, no variant/state props passed dynamically) and used in a Next.js App Router server component
- **THEN** the component SHALL render correctly on the server, producing the expected HTML with className attributes

#### Scenario: Component with variant props in client context
- **WHEN** a component receives variant or state props that trigger runtime className selection
- **THEN** the component SHALL work in a `"use client"` file where className concatenation executes in the browser

#### Scenario: Component with system props
- **WHEN** a component receives system props (e.g., `p={8}`) that map to utility classes at runtime
- **THEN** the component SHALL work in both server and client contexts — the className lookup is a pure object property access with no browser APIs

### Requirement: No forwardRef wrapper
The `createComponent` function SHALL return a plain function component that accepts `ref` as a regular prop (React 19 ref-as-prop pattern) instead of wrapping in `React.forwardRef`.

#### Scenario: Ref passed as prop
- **WHEN** a component is rendered with `<Button ref={myRef} />`
- **THEN** `myRef.current` SHALL reference the underlying DOM element, without the component being wrapped in `forwardRef`

#### Scenario: No ref passed
- **WHEN** a component is rendered without a ref
- **THEN** it SHALL render identically to the current `forwardRef` implementation

#### Scenario: React 19 compatibility
- **WHEN** the consuming application uses React 19 or later
- **THEN** ref-as-prop SHALL work natively without any polyfill

### Requirement: No pages-vs-app-router distinction in plugin
The webpack plugin and loader SHALL operate identically regardless of whether the consuming application uses Pages Router or App Router. Router detection SHALL NOT be performed.

#### Scenario: Pages Router application
- **WHEN** a Next.js application uses Pages Router with CSS imported in `_app.tsx`
- **THEN** the plugin and loader SHALL produce correct transforms and CSS output

#### Scenario: App Router application
- **WHEN** a Next.js application uses App Router with CSS imported in `layout.tsx`
- **THEN** the plugin and loader SHALL produce identical transforms and CSS output as Pages Router

#### Scenario: Mixed routing
- **WHEN** a Next.js application uses both Pages Router and App Router (migration scenario)
- **THEN** the plugin SHALL work correctly — CSS is a single file, transforms are per-file and router-agnostic
