import { migrateLegacyModeKey } from '@animus-ui/system/appearance';

/** Not the contract's legacy key, so the generated bootstrap never reads it;
 *  without this migration a returning visitor's mode is lost. */
const SHOWCASE_LEGACY_KEY = 'animus-color-mode';

export function migrateShowcaseLegacyKey(
  declaredModes: readonly string[]
): string | null {
  return migrateLegacyModeKey(SHOWCASE_LEGACY_KEY, declaredModes);
}
