import { Breakpoints } from '@animus-ui/core';

/**
 * 1. Breakpoints
 * 2. Scales
 * 3. Tokens
 * 4. Variables
 * 5. Colors
 * 6. Color Modes
 */

export class ThemeWithAll<Bps, Scales, Tokens, Vars> {
  breakpoints = {} as Bps;
  scales = {} as Scales;
  tokens = {} as Tokens;
  variables = {} as Vars;

  constructor(breakpoints: Bps, scales: Scales, tokens: Tokens, vars: Vars) {
    this.breakpoints = breakpoints;
    this.scales = scales;
    this.tokens = tokens;
    this.variables = vars;
  }

  addScale() {
    return new ThemeWithAll(
      this.breakpoints,
      this.scales,
      this.tokens,
      this.variables
    );
  }

  build() {
    return {
      breakpoints: this.breakpoints,
      ...this.scales,
      _tokens: this.tokens,
      _variables: this.variables,
    };
  }
}

export class ThemeWithRawColors<
  Bps extends Breakpoints,
  Scales,
  Tokens,
  Vars
> extends ThemeWithAll<Bps, Scales, Tokens, Vars> {
  constructor(breakpoints: Bps, scales: Scales, tokens: Tokens, vars: Vars) {
    super(breakpoints, scales, tokens, vars);
  }

  addColorModes() {
    return new ThemeWithAll(
      this.breakpoints,
      this.scales,
      this.tokens,
      this.variables
    );
  }
}

export class ThemeWithBreakpoints<Bps extends Breakpoints> extends ThemeWithAll<
  Bps,
  {},
  {},
  {}
> {
  constructor(breakpoints: Bps) {
    super(breakpoints, {}, {}, {});
  }

  addColors() {
    return new ThemeWithRawColors(
      this.breakpoints,
      this.scales,
      this.tokens,
      this.variables
    );
  }
}

export class ThemeUnitialized {
  addBreakpoints<Bps extends Breakpoints>(breakpoints: Bps) {
    return new ThemeWithBreakpoints(breakpoints);
  }
}
