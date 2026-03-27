import { describe, expect, test } from 'bun:test';

import browserslist from 'browserslist';
import {
  browserslistToTargets,
  transform as lcssTransform,
} from 'lightningcss';

/**
 * Minimal postProcessCss implementation for testing — mirrors the plugin's function.
 */
function postProcessCss(
  css: string,
  opts: { minify: boolean; targets: ReturnType<typeof browserslistToTargets> }
): string {
  const result = lcssTransform({
    filename: 'test.css',
    code: Buffer.from(css),
    minify: opts.minify,
    targets: opts.targets,
  });
  return result.code.toString();
}

const targets = browserslistToTargets(browserslist('defaults'));

describe('Lightning CSS: @layer preservation', () => {
  test('preserves all 6 cascade layers in correct order', () => {
    const input = `@layer global, base, variants, states, system, custom;

@layer base {
  .animus-Box-abc12345 {
    display: flex;
    flex-direction: column;
  }
}

@layer variants {
  .animus-Box-abc12345--size-sm {
    padding: 0.5rem;
  }
}

@layer states {
  .animus-Box-abc12345--disabled {
    opacity: 0.4;
  }
}

@layer system {
  .animus-u-def67890 {
    margin-top: 1rem;
  }
}

@layer custom {
  .animus-dyn-aabb1122-density {
    line-height: var(--animus-density);
  }
}`;

    const result = postProcessCss(input, { minify: true, targets });

    // All 6 layer names must appear in the output
    expect(result).toContain('global');
    expect(result).toContain('base');
    expect(result).toContain('variants');
    expect(result).toContain('states');
    expect(result).toContain('system');
    expect(result).toContain('custom');

    // Layer order must be preserved: global before base before variants etc.
    const globalIdx = result.indexOf('@layer global');
    const baseIdx = result.indexOf('@layer base');
    const variantsIdx = result.indexOf('@layer variants');
    const statesIdx = result.indexOf('@layer states');
    const systemIdx = result.indexOf('@layer system');
    const customIdx = result.indexOf('@layer custom');

    expect(globalIdx).toBeLessThan(baseIdx);
    expect(baseIdx).toBeLessThan(variantsIdx);
    expect(variantsIdx).toBeLessThan(statesIdx);
    expect(statesIdx).toBeLessThan(systemIdx);
    expect(systemIdx).toBeLessThan(customIdx);
  });

  test('does not merge layers with different names', () => {
    const input = `@layer base { .a { color: red; } }
@layer system { .b { color: blue; } }`;

    const result = postProcessCss(input, { minify: true, targets });

    // Both layer blocks should exist separately
    expect(result).toContain('@layer base');
    expect(result).toContain('@layer system');
  });
});

describe('Lightning CSS: var() preservation', () => {
  test('preserves CSS custom property references', () => {
    const input = `.foo {
  color: var(--colors-primary);
  background: var(--colors-background);
  padding: var(--animus-p);
}`;

    const result = postProcessCss(input, { minify: true, targets });

    expect(result).toContain('var(--colors-primary)');
    expect(result).toContain('var(--colors-background)');
    expect(result).toContain('var(--animus-p)');
  });

  test('preserves :root variable declarations', () => {
    const input = `:root {
  --colors-primary: #ff2800;
  --colors-background: #111;
}`;

    const result = postProcessCss(input, { minify: true, targets });

    expect(result).toContain('--colors-primary');
    expect(result).toContain('--colors-background');
    expect(result).toContain('#ff2800');
  });

  test('preserves per-breakpoint slot variables', () => {
    const input = `@layer system {
  .animus-dyn-p { padding: var(--animus-p); }
}
@media (min-width: 768px) {
  @layer system {
    .animus-dyn-p-sm { padding: var(--animus-p-sm); }
  }
}`;

    const result = postProcessCss(input, { minify: true, targets });

    expect(result).toContain('var(--animus-p)');
    expect(result).toContain('var(--animus-p-sm)');
  });
});

describe('Lightning CSS: minification', () => {
  test('minified output is smaller than raw input', () => {
    const input = `@layer base {
  .animus-Box-abc12345 {
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    background: var(--colors-background);
    border: 1px solid currentColor;
    border-color: var(--colors-border);
    transition: border-color 0.2s ease;
  }
  .animus-Box-abc12345:hover {
    border-color: var(--colors-primary);
  }
}

@layer variants {
  .animus-Box-abc12345--elevation-flat {
    box-shadow: none;
  }
  .animus-Box-abc12345--elevation-raised {
    box-shadow: 0 0 4px rgba(255, 40, 0, 0.2);
  }
}`;

    const minified = postProcessCss(input, { minify: true, targets });

    expect(minified.length).toBeLessThan(input.length);
    // Should not contain unnecessary whitespace
    expect(minified).not.toContain('  ');
  });

  test('non-minified output preserves formatting', () => {
    const input = `.foo {
  display: flex;
  color: red;
}`;

    const result = postProcessCss(input, { minify: false, targets });

    // Should still have newlines and indentation
    expect(result).toContain('\n');
  });
});

describe('Lightning CSS: autoprefixing', () => {
  test('adds vendor prefixes for older Safari targets', () => {
    const safariTargets = browserslistToTargets(browserslist('safari >= 14'));

    const input = `.foo {
  backdrop-filter: blur(8px);
  user-select: none;
}`;

    const result = postProcessCss(input, {
      minify: false,
      targets: safariTargets,
    });

    expect(result).toContain('-webkit-backdrop-filter');
    expect(result).toContain('-webkit-user-select');
    // Originals should also be preserved
    expect(result).toContain('backdrop-filter: blur(8px)');
    expect(result).toContain('user-select: none');
  });
});
