/**
 * The showcase's ONE appearance-specific fact: its own historical storage key
 * and that key's one-shot migration. Everything generic — record
 * read-modify-write, foreign-version refusal, `SYSTEM_MODE`,
 * `persistColorMode` — lives in `@animus-ui/system/appearance` (this module
 * was its prototype); consumers import the package directly so the boundary
 * stays visible.
 */
import { migrateLegacyModeKey } from '@animus-ui/system/appearance';

/**
 * The showcase's OWN pre-record key, written by the hand-rolled inline script
 * the generated bootstrap replaced. It is NOT the contract's legacy key
 * (`color-mode`), so the bootstrap does not know about it — without the
 * one-shot migration below, every returning visitor would silently lose their
 * mode. The key is ours, so migration may delete it.
 */
const SHOWCASE_LEGACY_KEY = 'animus-color-mode';

/**
 * One-shot migration of {@link SHOWCASE_LEGACY_KEY} into the record. Runs
 * post-paint from the app entry — see `migrateLegacyModeKey` for the accepted
 * single-flash semantics.
 *
 * @returns the migrated mode name, so the caller can apply it to the document
 *   for this one visit, or `null` when nothing was migrated.
 */
export function migrateShowcaseLegacyKey(
  declaredModes: readonly string[]
): string | null {
  return migrateLegacyModeKey(SHOWCASE_LEGACY_KEY, declaredModes);
}
