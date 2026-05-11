## 1. Rust Crate — Surface Diagnostics in Manifest

- [x] 1.1 Add `ExtractionDiagnostic` struct to project_analyzer.rs: `{ file, component, kind, message }`
- [x] 1.2 Stop discarding `_skip_warnings` — collect into diagnostics vec
- [x] 1.3 Collect bail reasons from non-extractable chains into diagnostics vec
- [x] 1.4 Add `diagnostics` field to `UniverseManifest` struct and include in serialized output

## 2. Vite Plugin — Print Diagnostics

- [x] 2.1 Read `diagnostics` array from parsed manifest in `buildStart`
- [x] 2.2 Print bail diagnostics: `warn(\`⚠ ${d.component} not extracted: ${d.message}\`)`
- [x] 2.3 Print skip diagnostics: `warn(\`⚠ ${d.component}: skipped ${d.message}\`)`
- [x] 2.4 Placed diagnostic printing after existing elimination warnings

## 3. Verification

- [ ] 3.1 Add canary test: source with dynamic expression → verify bail warning appears in manifest diagnostics
- [x] 3.2 Run `bun run build` — all TS packages build clean
- [x] 3.3 Run showcase build — builds correctly, no unexpected diagnostics (3 pre-existing elimination warnings only)
