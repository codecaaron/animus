## 1. Import Resolver: Package Resolution Support

- [ ] 1.1 Update `resolve_bindings` to accept a package resolution map: `package_map: &HashMap<String, String>` mapping package specifiers to entry file paths
- [ ] 1.2 In the `resolve_path` callback construction, check `package_map` for non-relative import sources before returning None
- [ ] 1.3 Support prefix matching: `@animus-ui/components` matches map key `@animus-ui/components` exactly (no glob needed — keys are full specifiers)
- [ ] 1.4 Add unit tests: package import resolved via map, package import with barrel re-export traced, unmatched package returns None, package import with rename resolved

## 2. Project Analyzer: Package Map Threading

- [ ] 2.1 Update `analyze` function signature to accept `package_map: &HashMap<String, String>`
- [ ] 2.2 Pass `package_map` through to the `resolve_path` callback used by `resolve_bindings`
- [ ] 2.3 Update `analyze_project` NAPI function to accept 5th parameter `package_resolution_json: String`
- [ ] 2.4 Parse package_resolution_json as `HashMap<String, String>` and pass to `analyze`
- [ ] 2.5 Backward compatibility: empty package_resolution_json `'{}'` produces same behavior as before

## 3. Vite Plugin: Package Discovery and Resolution

- [ ] 3.1 Add `packagePatterns` to `AnimusExtractOptions` with default `['@animus-ui/*']`
- [ ] 3.2 After discovering project source files, scan their content for package-name imports matching configured patterns (regex: `from ['"](<pattern>[^'"]+)['"]`)
- [ ] 3.3 Deduplicate discovered package specifiers
- [ ] 3.4 For each unique package specifier, call `this.resolve(specifier)` to get the absolute entry file path
- [ ] 3.5 For each resolved entry file, discover all .ts/.tsx files in the same source directory tree and add to file entries
- [ ] 3.6 Build the package resolution map: specifier → relative path of entry file
- [ ] 3.7 Pass the resolution map as 5th argument to `analyzeProject`

## 4. Integration Tests

- [ ] 4.1 Create test fixture pair: a "package" directory with barrel re-exports and component definitions, and a "consumer" file that imports via a package-style path
- [ ] 4.2 Add canary test: analyzeProject with package resolution map resolves components through barrel imports
- [ ] 4.3 Add canary test: components imported via resolved package are correctly tracked in rendered_components
- [ ] 4.4 Add canary test: reconciliation keeps components that are used via package imports (not eliminated)
- [ ] 4.5 Update Layer 5 snapshot: re-run with package resolution enabled, capture updated CSS output showing full extraction coverage
- [ ] 4.6 Add canary test: backward compatibility — empty package resolution map produces same results as before
