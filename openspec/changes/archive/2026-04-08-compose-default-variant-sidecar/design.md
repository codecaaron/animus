## Context

Compose families propagate shared variants from Root to children via CSS descendant selectors. Two rules per option per child maintain a specificity contract:

- **Inheritance** (`.Root.Root--var-opt .Child`): parent distributes variant to child — (0,3,0)
- **Override** (`.Root .Child.Child--var-opt`): child's explicit prop overrides parent — (0,3,0)

When a child has `defaultVariant`, the runtime applies the default's variant class (e.g., `--density-comfortable`) even when no prop is passed. This causes the override rule for the default option to match and tie with the inheritance rule from the parent at (0,3,0). Source order breaks the tie — the default's override rule comes later and wins. The parent's setting is ignored.

The runtime already passes `vc.default` to `resolveClasses` via the extracted config (transform_emitter.rs:160). The `resolveClasses` function currently uses `props[prop] ?? vc.default` at line 123, treating both paths identically for class name generation.

## Goals / Non-Goals

**Goals:**
- Parent's shared variant always overrides a child's `defaultVariant` in compose families
- Explicit child prop still overrides parent (preserving override rule semantics)
- All compose rules stay at (0,3,0) — no specificity inflation
- Standalone components with `defaultVariant` render identically (no behavioral change outside compose)

**Non-Goals:**
- Changing the compose rule structure (inheritance + override pair)
- Adding context-mode awareness to CSS emission
- Handling cases where `defaultVariant` varies across children in the same family (this works naturally — each child gets its own sidecar)

## Decisions

### 1. Sidecar class naming: `--{prop}-default`

When a variant value comes from `defaultVariant` fallback (not an explicit prop), the runtime emits `{className}--{prop}-default` instead of `{className}--{prop}-{value}`.

The CSS generator emits a sidecar rule: `.{className}--{prop}-default { ...default option's declarations... }`. This is a duplicate of the default option's styles at specificity (0,1,0).

**Why this name:** `default` is a reserved word in most languages and can never collide with a user-defined variant option name. It clearly communicates intent. The class carries no information about WHICH option is the default — that's a feature, not a bug. The sidecar is an alias.

**Alternative considered:** Using `--{prop}-fallback-{value}` (e.g., `--density-fallback-comfortable`). Rejected because it makes the override rule for "comfortable" match when the user meant "default," defeating the purpose.

### 2. Runtime branching in `resolveClasses`

Current code (resolveClasses.ts:122-128):
```typescript
for (const [prop, vc] of Object.entries(config.variants)) {
  const value = props[prop] ?? vc.default;
  if (value != null) {
    classes.push(`${baseClassName}--${prop}-${value}`);
  }
}
```

New code:
```typescript
for (const [prop, vc] of Object.entries(config.variants)) {
  const value = props[prop] ?? vc.default;
  if (value != null) {
    const isDefault = !(prop in props) && vc.default != null;
    classes.push(`${baseClassName}--${prop}-${isDefault ? 'default' : value}`);
  }
}
```

The `prop in props` check distinguishes "user passed the prop" from "fell through to default." When `isDefault` is true, the class uses `default` instead of the option name. This prevents the compose override rule from matching.

**Why `prop in props`:** Using `props[prop] === undefined` would fail if a user explicitly passes `undefined` (unlikely but possible). `in` checks for key presence regardless of value.

### 3. CSS generator emits sidecar in `@layer variants`

The sidecar rule is emitted inside `@layer variants` alongside normal variant rules. It uses the standalone variant format (single class selector, specificity 0,1,0):

```css
.animus-Child-xxx--density-default {
  /* same declarations as --density-comfortable */
}
```

This rule is only emitted when a variant has `defaultVariant`. It's a sibling of the existing per-option rules, not a replacement.

**Why not a separate layer:** Keeping it in `@layer variants` maintains the cascade contract. The sidecar's (0,1,0) is lower than compose rules (0,3,0) but participates in the same layer — no new layer ordering concerns.

### 4. No reconciler changes needed

The sidecar class (`--{prop}-default`) is a CSS-only artifact. The reconciler operates on variant OPTION names (e.g., "comfortable", "compact"), not class names. The sidecar rule is emitted for any variant that has `defaultVariant`, regardless of usage — it's structural, not usage-dependent. The reconciler doesn't need to know about it.

However, the reconciler must continue preserving variant options on compose children (the existing pre-population at project_analyzer.rs:1117-1140 handles this). No changes to reconciler logic.

**Alternative considered:** Having the reconciler track `--default` class usage. Rejected because the sidecar is always needed when `defaultVariant` exists — tracking adds complexity with no benefit.

## Risks / Trade-offs

- **Additional CSS per `defaultVariant`**: Each variant with `defaultVariant` emits one extra rule — a duplicate of the default option's declarations. For a typical component with 1-2 variants with defaults, this is ~2 extra rules. Minimal size impact.
  → Mitigation: The sidecar duplicates exactly one option's declarations. Gzip compresses duplicated content well.

- **`"default"` as option name collision**: If a user names a variant option `"default"`, the sidecar class would collide.
  → Mitigation: `"default"` is a JS reserved word. Builder chain validation could reject it as an option name, but this is a non-goal for this change. Document as a reserved name.

- **Compound variant interaction**: Compound variants match on `props[prop] ?? vc.default`. The compound logic already handles this correctly (resolveClasses.ts:135 uses the same fallback path). No interaction with sidecar class naming because compounds match on VALUES, not class names.
