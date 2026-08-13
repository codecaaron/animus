/**
 * Design-token provider (DESIGN §9, style-universe adjunct). Tokens are the
 * variable layer of the style universe: each CSS custom property, its value
 * per color mode, and the variables it references. Hosts derive this from
 * their emitted variable blocks; engines use it to resolve `var()` chains in
 * declaration values and to model `replace-token` world deltas.
 */
/**
 * The modeless declaration layer (`:root`). Not a mode: it holds the values
 * that apply when a mode block does not override them, so any per-mode lookup
 * in `valuesByMode` falls back to this key. Every provider and overlay must
 * share the fallback or a chain link declared only in `:root` silently breaks
 * the walk.
 */
export const ROOT_MODE = 'root';

export interface TokenDefinition {
  /** Custom-property name, including the leading dashes: `--color-primary`. */
  variable: string;
  /**
   * Raw value per mode name, with `ROOT_MODE` as the modeless fallback layer.
   * A value may itself be a `var()` reference — resolution order is the
   * `references` chain, not string inspection.
   */
  valuesByMode: Readonly<Record<string, string>>;
  /** Variables referenced by any per-mode value, in first-seen order. */
  references: readonly string[];
}

/**
 * Every `var(--x)` referenced by a declaration value, in first-seen order.
 * The one scanner for both the universe builder (which stamps `tokenRefs`
 * onto declarations) and the cascade (which resolves them) — two scanners
 * would let dependency edges drift from what resolution actually reads.
 */
export const tokenReferencesIn = (value: string): string[] => {
  const refs: string[] = [];
  const pattern = /var\(\s*(--[A-Za-z0-9_-]+)/g;
  for (;;) {
    const match = pattern.exec(value);
    if (match === null) break;
    if (!refs.includes(match[1])) refs.push(match[1]);
  }
  return refs;
};

export interface TokenResolution {
  /** Fully resolved terminal value for the requested mode. */
  value: string;
  /** Variable chain walked to reach it, starting at the queried variable. */
  chain: readonly string[];
}

export interface TokenProvider {
  modes(): readonly string[];
  /** The mode whose values apply when no mode dimension is bound. */
  defaultMode(): string;
  token(variable: string): TokenDefinition | undefined;
  all(): readonly TokenDefinition[];
  /**
   * Follow `var()` references to a terminal value under `mode`. Returns
   * undefined when the variable (or a link in its chain) is not modeled —
   * callers surface that as an obligation, never as a guessed value.
   */
  resolve(variable: string, mode: string): TokenResolution | undefined;
}
