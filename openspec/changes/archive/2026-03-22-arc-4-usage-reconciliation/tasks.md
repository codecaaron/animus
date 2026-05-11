## 1. JSX Scanner: Variant/State/Component Usage Tracking

- [ ] 1.1 Add `VariantUsage { component_binding, variant_prop, value }` struct and `StateUsage { component_binding, state_name }` struct to jsx_scanner.rs output types
- [ ] 1.2 Add `rendered_components: HashSet<String>` to scan_jsx output (track which component bindings appear as JSX element tags)
- [ ] 1.3 Extend JSX attribute scanning: when attribute name matches a known variant prop for the component, collect the variant value (string literal or "__dynamic__" for non-static)
- [ ] 1.4 Extend JSX attribute scanning: when attribute name matches a known state name for the component, collect the state activation
- [ ] 1.5 Detect variant prop absence: when a matched component element does NOT have a variant prop attribute, emit "__default__" for that variant prop
- [ ] 1.6 Update scan_jsx signature to accept variant/state prop name information per component (needed to distinguish variant/state props from system props)
- [ ] 1.7 Add unit tests: variant value collected, state activation collected, dynamic variant emits "__dynamic__", absent variant emits "__default__", component render tracked, non-rendered component not tracked

## 2. Usage Ledger

- [ ] 2.1 Create `UsageLedger` struct with `rendered_components: HashSet<String>`, `variant_usage: HashMap<String, HashMap<String, HashSet<String>>>`, `state_usage: HashMap<String, HashSet<String>>`
- [ ] 2.2 Implement `build_ledger(scan_results_per_file, component_manifest) -> UsageLedger` that aggregates all files' scanning results into a single ledger
- [ ] 2.3 Handle "__dynamic__" values: when variant value is "__dynamic__", add ALL defined options for that variant prop to the used set
- [ ] 2.4 Handle "__default__" values: when variant value is "__default__", add the component's defaultVariant option to the used set
- [ ] 2.5 Add unit tests: ledger aggregation across multiple files, dynamic variant transacts all options, default variant transacted when prop absent, component render tracking across files

## 3. CSS Reconciler

- [ ] 3.1 Implement `reconcile(components: &mut Vec<ComponentCss>, ledger: &UsageLedger, provenance: &HashMap<String, Vec<String>>) -> ReconciliationReport`
- [ ] 3.2 Remove entire ComponentCss entries for components not in `rendered_components` AND not in any provenance chain (not a parent)
- [ ] 3.3 Filter variant options: for each ComponentCss, remove VariantCss option entries whose option_name is not in the ledger's variant_usage for that component
- [ ] 3.4 Filter states: for each ComponentCss, remove state entries whose state_name is not in the ledger's state_usage for that component
- [ ] 3.5 Build ReconciliationReport with counts (components total/extracted/eliminated, variants total/used/eliminated, states total/used/eliminated, CSS bytes before/after)
- [ ] 3.6 Build eliminated_details list for the report
- [ ] 3.7 Add unit tests: unused variant option removed, all options kept when all used, unused state removed, entire unused component removed, parent component kept even if not rendered, reconciliation report counts correct

## 4. Pipeline Integration

- [ ] 4.1 Wire extended scan_jsx into project_analyzer Phase 5b — pass variant/state prop names per component alongside system prop names
- [ ] 4.2 Call build_ledger after JSX scanning with aggregated results from all files
- [ ] 4.3 Call reconcile on the ComponentCss list before passing to generate_css_ordered
- [ ] 4.4 Add usage ledger data to UniverseManifest struct (new `usage` field)
- [ ] 4.5 Add extraction report to UniverseManifest struct (new `report` field)
- [ ] 4.6 Serialize usage and report in the manifest JSON output

## 5. Integration Tests

- [ ] 5.1 Create test fixture: component with 3 variant options where only 1 is used at JSX callsites + component with 2 states where only 1 is activated
- [ ] 5.2 Create test fixture: component defined but never rendered (dead component)
- [ ] 5.3 Add canary test: reconciled CSS does NOT contain eliminated variant option rules
- [ ] 5.4 Add canary test: reconciled CSS does NOT contain eliminated state rules
- [ ] 5.5 Add canary test: dead component's CSS entirely absent from output
- [ ] 5.6 Add canary test: extraction report contains correct elimination counts
- [ ] 5.7 Add canary test: default variant kept when component rendered without explicit variant prop
- [ ] 5.8 Add Layer 4 concentric snapshot: reconciled CSS for fixture with dead variants/states/components — exact output comparison
