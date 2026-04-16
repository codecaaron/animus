## Why

The five publishable packages have no READMEs, no npm keywords, and incomplete package.json metadata. The root README references Emotion, the old `animus.styles()` API, and the renamed `.groups()` method. The showcase docs site still uses `.groups()` in markdown content. A consumer arriving via npm or GitHub sees nothing useful — or worse, actively misleading information.

This is blocking RC readiness. The pipeline is provably complete (395 tests, 150 canary, 188 Rust, showcase builds clean) but the consumer surface doesn't reflect the current state of the project.

## What Changes

- **Root README.md**: Complete rewrite. Remove Emotion positioning, fix API examples to use `ds.styles()` and `.system()`, show the actual happy path (pre-built groups composed into semantic groups, token refs, builder chain).
- **Package READMEs (×5)**: Create for `system`, `extract`, `vite-plugin`, `next-plugin`, `properties`. Each scoped to what a consumer of THAT package needs — install, setup, basic usage. Consumer-facing packages (system, vite-plugin, next-plugin) get real examples. Internal packages (extract, properties) get brief "this is a transitive dep" explanations.
- **package.json metadata**: Add `homepage` (deep-linked to package directory), `repository.directory`, and `keywords` to all 5 publishable packages. Keywords should reflect what people search for on npm, not internal architecture terms.
- **Showcase docs audit**: Fix stale `.groups()` references to `.system()` in markdown content files (`getting-started.md`, `builder-chain.md`, `create-system.md`). TSX component files already use `.system()` correctly.
- **thinking-in-animus skill**: Minor refresh — verify API references match current codebase, fix any stale method names.

## Capabilities

### New Capabilities
- `package-readmes`: Requirements for what each publishable package's README must contain — install instructions, quick start, code examples using current API, and appropriate scope (consumer-facing vs internal).
- `npm-package-metadata`: Requirements for package.json discoverability fields across all publishable packages — homepage, repository.directory, keywords, description accuracy.

### Modified Capabilities
- `developer-knowledge-docs`: Add requirement that consumer-facing README content must not conflict with internal CLAUDE.md content (same APIs, same terminology, same package names).

## Impact

- **Files**: `README.md` (root), `packages/{system,extract,vite-plugin,next-plugin,properties}/README.md`, `packages/*/package.json` (×5), `packages/showcase/src/content/*.md` (3-4 files), `.claude/skills/thinking-in-animus/*.md`
- **No code changes**: All changes are documentation and metadata. No runtime, type, or build changes.
- **npm**: Keywords and homepage will appear on next publish. README content will display on npm package pages.
