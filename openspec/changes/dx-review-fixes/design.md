## Context

Three-lens DX review identified bugs and hygiene items in the consumer surface. All items are scoped, low-risk, and independently deployable. No architectural changes — these are fixes within existing patterns.

## Goals / Non-Goals

**Goals:**
- Fix inline scale serialization so `withProperties()` entries with MapScale/ArrayScale objects reach Rust
- Eliminate deepMerge duplication
- Remove DX traps (vestigial `.build()`, stale comments)
- Harden build pipeline (strict mode throw, globalThis namespace)

**Non-Goals:**
- No new features or API surface changes
- No documentation work (separate effort)
- No extraction pipeline changes beyond receiving already-supported scale formats
- No changes to the component builder chain API (beyond `.build()` deprecation)

## Decisions

### 1. Inline scale serialization — JSON.stringify the scale object

`SystemBuilder.serialize()` currently guards `typeof scale === 'string'`. Extend to serialize inline scales as JSON when they're objects or arrays. The Rust `PropConfig` struct already handles `Scale::Map` and `Scale::Array` via serde — the gap is purely in the TS serializer.

**Why not a new serialization format?** The existing JSON format works. Rust already parses object scales from the `config.scale` field via serde's tagged enum. We just need to pass them through.

Also serialize the `negative: true` flag — same gap, same fix pattern.

### 2. deepMerge — extract to `packages/system/src/utils/deepMerge.ts`

Character-identical copies exist at `Animus.ts:26-46` and `AnimusExtended.ts:22-42`. Extract to a shared module, import from both. No behavioral change.

### 3. `.build()` — remove the method entirely

The method returns `(() => ({})) as (props) => CSSObject` — a no-op with a lying type signature. It exists for the `.extend()` pattern, but `.extend()` is also available on `.asElement()`, `.asComponent()`, and `.asClass()` returns. The only consumer of `.build()` is the `extend` binding on its return value, which can move to the other terminals.

**Why remove rather than deprecate?** A deprecated method still appears in autocomplete and can still trap new users. The method has no legitimate use case in the extraction-based architecture. Clean removal is better than deprecation noise.

### 4. globalThis — scope with plugin instance ID

Replace bare `globalThis.__animus_system_resolve_script` with a closure-scoped variable in the plugin factory function. The resolve script path doesn't need to be global — it's only used within the same plugin instance's lifecycle.

For `__animus_component_sheet__` (HMR adopted stylesheet): namespace with a hash derived from the system module path, e.g., `__animus_sheet_${hash}__`.

### 5. Strict mode throw — check `options.strict` on subprocess failure

The vite plugin's `loadSystem()`, `resolveGlobalStyles()`, and transform resolution wrap subprocess calls in try/catch and log warnings on failure. When `options.strict` is `true`, these should throw instead of warn.

### 6. Stale comment — just delete it

Card.tsx lines 12-14 describe a constraint that `scan_compose_calls` (session 24) already resolved. Remove the comment. Keep the exports (they serve module organization, just not extraction necessity).

## Risks / Trade-offs

- **`.build()` removal is technically breaking** → But no known consumer uses it. The method returns an empty object. Anyone calling it is already getting nothing useful. Risk: near zero.
- **globalThis rename could break running dev servers** → Only on HMR hot-path. A dev server restart resolves it. Not a deployment concern.
- **Inline scale serialization could surface latent Rust parsing issues** → Mitigated by the fact that Rust already handles `Scale::Map` and `Scale::Array` in its serde definitions. The data path exists, it's just never been fed.
