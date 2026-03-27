# **MANDATORY** RULES

1. Never use mutative git operations

## Monorepo Build System

### Package Build Order

```
extract (Rust/NAPI) → core → theming → runtime → system → vite-plugin → ui → showcase
```

All TS packages use `tsdown && tsc -p tsconfig.build.json`. The Rust crate uses `napi build --platform --release`.

### Verification Commands

| Command | What it does | When to use |
|---------|-------------|-------------|
| `bun run verify` | build:ts + test + biome check | Fast check — TS only, no Rust, no showcase |
| `bun run verify:full` | build:all + test + check + showcase build | Full pipeline proof — use after any extraction changes |
| `bun run verify:showcase` | build:all + showcase build | Focused extraction verification |
| `bun run test:canary` | Rust extraction canary tests only | After changing Rust crate |
| `bun run rebuild` | clean:full + build:all | Guaranteed fresh state from any corruption |

### Cache Tiers

| Command | Removes | Speed | Use when |
|---------|---------|-------|----------|
| `bun run clean:light` | `.vite` cache + `dist/` | Fast (<1s) | Transforms seem stale, styles not updating |
| `bun run clean:full` | Above + Rust `target/` + `.node` binary | Slow (rebuild = 30-60s) | NAPI errors, signature changes, nothing works |
| `bun run clean` | `dist/` + `target/` only | Fast | Legacy, backward compat |

### Debugging Decision Tree

```
Symptom                              → Fix
─────────────────────────────────────────────────────────────
Styles not updating in dev           → Restart dev server
Transforms seem stale                → bun run clean:light
NAPI function errors / wrong arity   → bun run rebuild
Showcase builds but styles missing   → Check virtual:animus/styles.css in browser devtools
CSS has __TRANSFORM__ placeholders   → Transform subprocess failed — check terminal warnings
"Nothing works"                      → bun run rebuild (nuclear option)
```

### Key Rules

- **bun** is the package manager. Never npm/npx.
- **No React resolve aliases** in vite.config.ts — they break the extraction transform pipeline.
- **Extraction is production AND dev.** The plugin runs in both modes. Dev server holds buildStart results in memory — restart to pick up system changes.
- See package-level CLAUDE.md files in `extract/`, `vite-plugin/`, `showcase/` for detailed per-package guidance.
