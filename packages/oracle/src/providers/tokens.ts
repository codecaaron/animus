/**
 * Design-token provider (DESIGN §9, style-universe adjunct). Tokens are the
 * variable layer of the style universe: each CSS custom property, its value
 * per color mode, and the variables it references. Hosts derive this from
 * their emitted variable blocks; engines use it to resolve `var()` chains in
 * declaration values and to model `replace-token` world deltas.
 */
export interface TokenDefinition {
  /** Custom-property name, including the leading dashes: `--color-primary`. */
  variable: string;
  /**
   * Raw value per mode name. A value may itself be a `var()` reference —
   * resolution order is the `references` chain, not string inspection.
   */
  valuesByMode: Readonly<Record<string, string>>;
  /** Variables referenced by any per-mode value, in first-seen order. */
  references: readonly string[];
}

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
