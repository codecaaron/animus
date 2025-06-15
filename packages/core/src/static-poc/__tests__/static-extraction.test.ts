/**
 * POC Test: Validates static extraction concepts
 *
 * Success criteria:
 * 1. Can intercept build() method and generate atomic classes
 * 2. Can attach static configuration to components
 * 3. Can generate complete CSS stylesheet
 *
 * Note: Full static extraction requires build-time transformation.
 * This POC validates the core concepts without full Emotion bypass.
 *
 * @jest-environment node
 */

// Polyfill for TextEncoder in Node environment
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

import * as React from 'react';
import { renderToString } from 'react-dom/server';

import { animus } from '../../index';
import { AnimusStatic, collectStyles, getStyleSheet } from '../static-mode';

describe('Static Extraction POC', () => {
  beforeEach(() => {
    // Clear any collected styles between tests
    collectStyles.clear();
  });

  it('should intercept build method and generate atomic CSS', () => {
    // Enable static mode
    AnimusStatic.enable();

    // Define a component using animus API
    animus
      .styles({
        padding: '1rem',
        backgroundColor: 'blue',
        color: 'white',
      })
      .asElement('button');

    // Get generated stylesheet
    const styleSheet = getStyleSheet();

    // Assertions
    // 1. Check that atomic classes were generated
    expect(styleSheet).toContain('._p-1rem { padding: 1rem; }');
    expect(styleSheet).toContain('._bg-blue { background-color: blue; }');
    expect(styleSheet).toContain('._col-white { color: white; }');

    // 2. Verify our build method was called and generated config
    // Since we can't directly access the style function after emotion processes it,
    // we'll test the build function directly
    const buildFn = animus.styles({ margin: '2rem' }).build();

    // Check that build returns a function with static config
    expect(typeof buildFn).toBe('function');
    expect((buildFn as any).__staticConfig).toBeDefined();
    expect((buildFn as any).__staticConfig.baseClasses).toHaveLength(1);
    expect((buildFn as any).__staticConfig.baseClasses[0].className).toBe(
      '_m-2rem'
    );

    AnimusStatic.disable();
  });

  it('should handle variants in static configuration', () => {
    AnimusStatic.enable();

    // Build the style function directly to test it
    const buildFn = animus
      .styles({
        padding: '1rem',
        backgroundColor: 'gray',
      })
      .variant({
        prop: 'size',
        variants: {
          small: { padding: '0.5rem' },
          large: { padding: '1.5rem' },
        },
      })
      .build();

    // Test that variants are in the static config
    const staticConfig = (buildFn as any).__staticConfig;
    expect(staticConfig).toBeDefined();
    expect(staticConfig.variantClasses).toBeDefined();
    expect(staticConfig.variantClasses.size).toBeDefined();
    expect(staticConfig.variantClasses.size.small).toBeDefined();
    expect(staticConfig.variantClasses.size.large).toBeDefined();

    // Test small variant class generation
    const smallResult = buildFn({ size: 'small' });
    expect(smallResult.className).toContain('_p-0_5rem');
    expect(smallResult.className).not.toContain('_p-1rem'); // Should override base

    // Test large variant class generation
    const largeResult = buildFn({ size: 'large' });
    expect(largeResult.className).toContain('_p-1_5rem');

    AnimusStatic.disable();
  });

  it('should handle component extension', () => {
    AnimusStatic.enable();

    // Create base component
    const baseBuilder = animus.styles({
      padding: '1rem',
      borderRadius: '4px',
    });

    // Get the build function
    const baseBuildFn = baseBuilder.build();

    // Verify extend is available on the build function
    expect(typeof baseBuildFn.extend).toBe('function');

    // Create extended component using build().extend()
    const extendedBuilder = baseBuildFn.extend().styles({
      backgroundColor: 'blue',
      color: 'white',
    });

    const extendedBuildFn = extendedBuilder.build();

    // Check that extended build has combined styles
    const extendedConfig = (extendedBuildFn as any).__staticConfig;
    expect(extendedConfig).toBeDefined();
    expect(extendedConfig.baseClasses).toBeDefined();

    // Get all class names
    const classNames = extendedConfig.baseClasses.map((c: any) => c.className);

    // Should have both base and extended classes
    expect(classNames).toContain('_p-1rem');
    expect(classNames).toContain('_br-4px');
    expect(classNames).toContain('_bg-blue');
    expect(classNames).toContain('_col-white');

    AnimusStatic.disable();
  });

  it('should not interfere with runtime mode when disabled', () => {
    AnimusStatic.disable();

    const Button = animus.styles({ padding: '1rem' }).asElement('button');

    const html = renderToString(
      React.createElement(Button, null, 'Runtime mode')
    );

    // Should work normally when static mode is off
    expect(html).toMatch(/css-\w+/);

    // And our static config should not be attached to build
    const buildFn = animus.styles({ padding: '1rem' }).build();
    expect((buildFn as any).__staticConfig).toBeUndefined();
  });
});
