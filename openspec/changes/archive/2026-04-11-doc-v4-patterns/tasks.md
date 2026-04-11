## 1. New Narrative Components

- [x] 1.1 Create BeforeAfter component — container, pane headers (label + status tag), 1fr 1fr grid, two embedded SyntaxBlocks with bordered={false}
- [x] 1.2 Create MetricCard + MetricGrid — big mono value, unit suffix, label, delta badge with good/neutral variant
- [x] 1.3 Create BundleBar — labeled rows with background track, colored fill via variant (runtime/extracted/static), CSS width transition

## 2. Primitive Upgrades

- [x] 2.1 Callout: add `deprecated` variant — dashed border-left, violet/purple colors, icon + title entries, update compose() family
- [x] 2.2 ParamTable: replace RequiredMark text with RequiredDot (5px accent circle, inline-block, ml:4, verticalAlign middle)
- [x] 2.3 SyntaxBlock: add FileDot element (8px circle) in TitleBarLeft before title text, color variant by language (blue=ts, green=css, amber=sh)
- [x] 2.4 Create APIBlock wrapper — bordered container that wraps TypeSignature (header) + ParamTable (body), strips individual borders from children

## 3. Kitchen Sink Integration

- [x] 3.1 Add BeforeAfter section to component-test.mdx with real ds → extracted CSS example
- [x] 3.2 Add MetricGrid section with build stats (0kb runtime, CSS size, test count)
- [x] 3.3 Add BundleBar section with size comparison data
- [x] 3.4 Add deprecated Callout example alongside existing callout variants
- [x] 3.5 Update ParamTable example to include a required param demonstrating the dot
- [x] 3.6 Add APIBlock example wrapping TypeSignature + ParamTable
- [x] 3.7 Verify all existing SyntaxBlock examples with titles show the file-type dot

## 4. Verification

- [x] 4.1 Type check: zero TS errors across showcase
- [x] 4.2 Visual audit: check all new/upgraded components in dev server
