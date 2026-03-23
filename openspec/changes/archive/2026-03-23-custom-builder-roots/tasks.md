## 1. Chain Walker: Remove hardcoded root name

- [x] 1.1 Removed `root_identifier == "animus"` check in `chain_walker.rs`
- [x] 1.2 Any identifier with recognized chain methods + valid terminal is now a primary chain
- [x] 1.3 Extension chains distinguished by `.extend()` marker (unchanged)
- [x] 1.4 All 150 Rust + 82 integration tests pass

## 2. Core Exports for Custom Instances

- [x] 2.1 Exported group objects (color, border, flex, grid, space, layout, typography, shadows, background, positioning, transitions) from `@animus-ui/core`
- [x] 2.2 Rebuilt core dist

## 3. Showcase Validation

- [x] 3.1 Custom vocabulary components (Panel, Arrange, GridArrange, Prose, Chip) now extract to static CSS
- [x] 3.2 29 total components extracted in showcase build
