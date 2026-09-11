export const ROOT_MODE = 'root';

export interface TokenDefinition {
  variable: string;
  valuesByMode: Readonly<Record<string, string>>;
  references: readonly string[];
}

/**
 * The one `var()` scanner for both the universe builder and the cascade, in
 * first-seen order: two scanners would let dependency edges drift.
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
  value: string;
  chain: readonly string[];
}

export interface TokenProvider {
  modes(): readonly string[];
  defaultMode(): string;
  token(variable: string): TokenDefinition | undefined;
  all(): readonly TokenDefinition[];
  resolve(variable: string, mode: string): TokenResolution | undefined;
}
