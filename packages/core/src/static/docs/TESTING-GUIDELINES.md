# Animus Static Extraction - Testing Guidelines

## Core Principle: Right Tool for the Right Test

### Use Snapshots ONLY for CSS Output

CSS output is best tested via snapshots because:
- Visual structure is immediately apparent
- Whitespace and formatting matter
- Changes are easy to review in diffs
- CSS is the final output artifact

```typescript
// ✅ GOOD: CSS output as snapshot
expect(generator.generateCSS(styles)).toMatchSnapshot();
```

### Use Assertions for Data Structures

TypeScript objects, JSON structures, and intermediate representations should use explicit assertions:
- More precise testing of specific properties
- Better error messages when tests fail
- Less context consumption in AI tools
- Easier to understand test intent

```typescript
// ❌ BAD: Snapshot for data structure
expect(extracted).toMatchSnapshot();

// ✅ GOOD: Explicit assertions
expect(extracted.baseStyles).toEqual({
  display: 'flex',
  padding: '16px'
});
expect(extracted.variants).toHaveLength(2);
expect(extracted.variants[0].prop).toBe('size');
```

## Testing Patterns

### 1. Extraction Tests

```typescript
it('should extract style properties', () => {
  const code = `animus.styles({ color: 'red', padding: 16 })`;
  const extracted = extractStylesFromCode(code);
  
  // Assert structure, not snapshot
  expect(extracted[0].baseStyles).toEqual({
    color: 'red',
    padding: 16
  });
});
```

### 2. Usage Collection Tests

```typescript
it('should track component usage', () => {
  const usage = extractComponentUsage(jsxCode);
  const usageMap = buildUsageMap(usage);
  
  // Assert specific values
  expect(usageMap.Box.p).toEqual(new Set(['4:_', '2:sm']));
  expect(usageMap.Box.m).toContain('0:_');
});
```

### 3. CSS Generation Tests

```typescript
it('should generate correct CSS', () => {
  const css = generator.generateFromExtracted(extracted);
  
  // CSS output is perfect for snapshots
  expect(css).toMatchSnapshot();
});
```

## Benefits

1. **Reduced Context Usage**: AI tools don't waste tokens on repetitive snapshot data
2. **Better Test Clarity**: Intent is clear from assertions
3. **Easier Debugging**: Failures point to specific properties
4. **Maintainable Tests**: Changes don't cascade through massive snapshots

## Anti-Patterns to Avoid

```typescript
// ❌ Snapshots for arrays of objects
expect(extractedComponents).toMatchSnapshot();

// ❌ Snapshots for configuration objects  
expect(buildConfig()).toMatchSnapshot();

// ❌ Snapshots for intermediate representations
expect(astNode).toMatchSnapshot();
```

## Summary

- **Snapshots**: CSS output only
- **Assertions**: Everything else
- **Focus**: Test behavior, not implementation
- **Clarity**: Make test intent obvious