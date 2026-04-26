/**
 * Shared integration test fixture: re-exports from the canary test-system
 * and adds serialized output for NAPI consumption.
 *
 * Single source of truth: packages/extract/tests/test-system.ts owns
 * the system + theme definition. Both canary and integration tiers
 * share the same fixture, ensuring convergence.
 */
export { tokens } from '../../extract/tests/test-system';

import { ds, tokens } from '../../extract/tests/test-system';

// ─── Serialized Output ─────────────────────────────────────
export const config = ds.toConfig();
export const theme = tokens.serialize();
