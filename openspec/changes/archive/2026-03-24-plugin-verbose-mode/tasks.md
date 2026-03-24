## 1. Plugin Options & Activation

- [x] 1.1 Add `verbose?: boolean` to `AnimusExtractOptions` interface
- [x] 1.2 Add verbose flag resolution: `options.verbose || process.env.ANIMUS_DEBUG === '1' || process.env.ANIMUS_DEBUG === 'true'`
- [x] 1.3 Capture Vite logger from `configResolved` hook and store on plugin state

## 2. Reconciliation Warnings (Always-On)

- [x] 2.1 After `analyzeProject` returns, parse `manifest.report.eliminated_details` array
- [x] 2.2 For each eliminated component (`kind: "component"`), emit `logger.warn('[animus] ⚠ <binding> eliminated: <reason>')`
- [x] 2.3 For each eliminated variant (`kind: "variant"`), emit `logger.warn('[animus] ⚠ <binding> variant <name> pruned: <reason>')`
- [x] 2.4 For each eliminated state (`kind: "state"`), emit `logger.warn('[animus] ⚠ <binding> state <name> pruned: <reason>')`

## 3. Verbose buildStart Logging

- [x] 3.1 Add timing wrapper: capture `performance.now()` before and after each phase
- [x] 3.2 Log system load: `[animus] System loaded: <n> props, <n> groups (<ms>ms)`
- [x] 3.3 Log file discovery: `[animus] Discovered <n> files (<n> from packages)`
- [x] 3.4 Log analysis: `[animus] Extracted <extracted>/<total> components (<ms>ms)`
- [x] 3.5 Log reconciliation summary: `[animus] Reconciliation: <n> components, <n> variants pruned, <n> states pruned`
- [x] 3.6 Log CSS summary: `[animus] CSS: <n> bytes (<n> components)`

## 4. Verbose Transform & HMR Logging

- [x] 4.1 In `transform` hook, log `[animus] transform <path>: <n> components` when `hasComponents` is true
- [x] 4.2 In `handleHotUpdate`, log skip decisions: `[animus] HMR skip: <filename> (unchanged)`
- [x] 4.3 In `handleHotUpdate`, log geological resets: `[animus] HMR geological reset: <filename>`

## 5. Documentation & Verification

- [x] 5.1 Update `packages/vite-plugin/CLAUDE.md` with verbose mode documentation
- [x] 5.2 Rebuild vite-plugin (`bun run --filter '@animus-ui/vite-plugin' build`)
- [x] 5.3 Run showcase build with `ANIMUS_DEBUG=1` and verify output includes phase checkpoints
- [x] 5.4 Verify StratumRow elimination reason is surfaced in warnings — **root cause found and fixed: JSX scanner CallExpression bug**
