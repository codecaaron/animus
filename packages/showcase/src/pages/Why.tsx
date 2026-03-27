import {
  Heading,
  InlineCode,
  List,
  ListItem,
  Mono,
  Prose,
  Stack,
} from '../components';

export default function Why() {
  return (
    <Stack gap={64}>
      <Stack gap={16}>
        <Heading level={2}>The Problem</Heading>
        <Prose>
          Runtime CSS-in-JS was the best idea we had for a decade. Emotion,
          styled-components, and their kin gave us something genuinely good:
          styles colocated with components, design tokens as first-class values,
          variant systems you could reason about in TypeScript. The authoring
          experience was honest. You described what a component looked like and
          the library made it so.
        </Prose>
        <Prose>
          The cost was deferred until production. Every render triggered style
          serialization. Class names were computed at runtime, injected into the
          document, then recalculated on every update. The React Server
          Components model — which moves rendering to the server and streams
          results — broke the assumption entirely. You cannot inject styles into
          a browser document from a server process. Runtime CSS-in-JS and RSC
          are architecturally incompatible.
        </Prose>
        <Prose>
          Serialization overhead was measurable in profiling traces. Style
          injection caused layout thrash on mount. Bundle sizes carried the
          runtime library whether you used one variant or a hundred. The
          developer experience had been purchased on credit, and the bill
          arrived.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>The Failed Alternatives</Heading>
        <Prose>
          Two exits appeared, and both were compromises.
        </Prose>
        <Prose>
          Utility-first CSS — Tailwind and its derivatives — solved the runtime
          problem by eliminating the abstraction entirely. There are no
          components. There are no variants. There is no type system connecting
          your tokens to your callsites. You write class strings in JSX and hope
          the purge step catches everything. The DX traded one failure mode for
          another: a design system you cannot refactor.
        </Prose>
        <Prose>
          CSS Modules preserved scoping and eliminated runtime cost, but they
          exist outside the TypeScript type system. Your token values are strings
          in a <InlineCode>.module.css</InlineCode> file. Your editor does not
          know them. Your variants are conditional class name concatenations.
          Dynamic values require inline styles. The compiler boundary severed the
          connection between your design decisions and the types that enforce
          them.
        </Prose>
        <Prose>
          Both approaches required developers to choose: keep the authoring model
          or keep the performance. The assumption was that you could not have
          both.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>The Animus Approach</Heading>
        <Prose>
          Animus does not move the authoring model to a different runtime. It
          removes the runtime entirely.
        </Prose>
        <Prose>
          You write components using the same builder chain, the same design
          tokens, the same variant API. The TypeScript types are identical. The
          chain flows from base styles through variants, compounds, states, and
          system overrides, then seals into a typed React component with{' '}
          <InlineCode>asElement()</InlineCode>. Nothing about the authoring
          experience changes.
        </Prose>
        <Prose>
          What changes is what happens at build time. The{' '}
          <InlineCode>animusExtract()</InlineCode> Vite plugin runs an OXC-based
          Rust pipeline that walks your module graph as an AST. It finds every
          builder chain, evaluates it in a subprocess, resolves every token
          reference to its final value, and emits static CSS into a virtual
          stylesheet. The JavaScript style definitions are tree-shaken away. What
          ships to the browser is a thin React wrapper and platform CSS — no
          serializer, no injector, no style object at runtime.
        </Prose>
        <Prose>
          This is not a runtime with a fast path. It is not a compiler that still
          ships a runtime for edge cases. Every style value must be a static
          literal resolvable at build time — the constraint is enforced at the
          type level. What crawls out of the build process is not a smarter
          runtime. It is something closer to what you would have written by hand
          if you had infinite patience and a perfect memory for specificity rules.
        </Prose>
        <Prose>
          Not a runtime. A compiler.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>The Cascade Contract</Heading>
        <Prose>
          Specificity is the hidden variable in every CSS system. When two rules
          conflict, the browser resolves the conflict using a specificity
          calculation that was designed for documents, not design systems. Utility
          frameworks respond by making every rule equally specific and relying on
          source order. Runtime libraries respond with inline styles and{' '}
          <InlineCode>!important</InlineCode>. Both are workarounds for a
          fundamental ordering problem.
        </Prose>
        <Prose>
          Animus makes the ordering explicit. Each step in the builder chain maps
          to a named CSS <InlineCode>@layer</InlineCode>. Layers have a fixed
          cascade position. When two rules conflict, the layer position determines
          the winner — not selector specificity, not source order, not the number
          of class names. There are seven layers, from lowest to highest
          precedence:
        </Prose>
        <List>
          <ListItem>
            <Mono>global</Mono> — reset, <InlineCode>html</InlineCode>/
            <InlineCode>body</InlineCode>, keyframes
          </ListItem>
          <ListItem>
            <Mono>base</Mono> — static styles declared on the component
          </ListItem>
          <ListItem>
            <Mono>variants</Mono> — prop-driven variant selections
          </ListItem>
          <ListItem>
            <Mono>compounds</Mono> — multi-prop variant intersections
          </ListItem>
          <ListItem>
            <Mono>states</Mono> — pseudo-class and interactive overrides
          </ListItem>
          <ListItem>
            <Mono>system</Mono> — runtime prop overrides passed at the callsite
          </ListItem>
          <ListItem>
            <Mono>custom</Mono> — consumer escape hatch, highest precedence
          </ListItem>
        </List>
        <Prose>
          Specificity is flat within each layer — every rule is a single class.
          Position determines precedence. A system prop override always wins over
          a base style, regardless of how the selectors are written.{' '}
          <InlineCode>!important</InlineCode> is never needed, because the
          ordering contract is explicit and static.
        </Prose>
        <Prose>
          This is the cascade contract. You trade implicit specificity arithmetic
          for explicit layer position. The trade is always in your favor.
        </Prose>
      </Stack>

      <Stack gap={16}>
        <Heading level={2}>When To Use / When Not</Heading>
        <Prose>
          Animus pays dividends in a specific context. It is worth being direct
          about where it fits and where it does not.
        </Prose>
        <Prose>Reach for Animus when:</Prose>
        <List>
          <ListItem>
            You are building in React with Vite and want a design system with
            typed tokens, component variants, and no runtime cost
          </ListItem>
          <ListItem>
            You need IDE autocomplete and compile-time enforcement of your token
            vocabulary across every component callsite
          </ListItem>
          <ListItem>
            Your project targets React Server Components, static rendering, or
            any environment where runtime style injection is not viable
          </ListItem>
          <ListItem>
            Bundle size and Time to First Paint are measured and matter — no
            runtime serializer means those numbers improve
          </ListItem>
        </List>
        <Prose>Look elsewhere when:</Prose>
        <List>
          <ListItem>
            You need styles computed from arbitrary runtime values — values not
            known at build time cannot be extracted. Inline styles remain the
            correct tool for that problem.
          </ListItem>
          <ListItem>
            You are not using React. The builder chain produces React components.
            There is no Vue adapter, no Svelte integration, no web-component
            output.
          </ListItem>
          <ListItem>
            You are not using Vite. The extraction pipeline is a Vite plugin.
            Webpack, esbuild, and other bundlers are not supported.
          </ListItem>
          <ListItem>
            You are building a small prototype where the setup cost is not
            justified. If you have three components and no token system, reach
            for something simpler.
          </ListItem>
        </List>
        <Prose>
          The honest summary: Animus is a design-system tool. It was built for
          teams with a token vocabulary, a component library, and callsites that
          need to stay aligned with both. If that context does not describe your
          project, it probably does not describe your problem either.
        </Prose>
      </Stack>
    </Stack>
  );
}
