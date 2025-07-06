import { describe, expect, it } from 'vitest';

import { extractStylesFromCode } from '../extractor';
import { CSSGenerator } from '../generator';
import { testGroups as groupDefinitions, testTheme } from './test-utils';

/**
 * QUANTUM TEST: Real Component Patterns
 *
 * This test suite validates extraction and generation for real-world
 * component patterns using string-based testing.
 */

describe('[QUANTUM] Real Component Patterns', () => {
  const generator = new CSSGenerator();

  describe('Component Extraction', () => {
    it('extracts Logo component with complex styles', () => {
      const logoCode = `
        import { animus } from '@animus-ui/core';
        import { flow } from '../../animations/flow';

        export const Logo = animus
          .styles({
            width: 'max-content',
            fontSize: 30,
            m: 0,
            lineHeight: 'initial',
            fontFamily: 'logo',
            letterSpacing: '2px',
            gradient: 'flowX',
            backgroundSize: '300px 100px',
            animation: \` \${flow} 5s linear infinite\`,
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: 'logo',
            transition: 'text',
          })
          .states({
            link: {
              animation: 'none',
              '&:hover': {
                textShadow: 'logo-hover',
                animation: \` \${flow} 5s linear infinite\`,
              },
              '&:active': {
                textShadow: 'link-pressed',
              },
            },
          })
          .groups({ typography: true })
          .props({
            logoSize: {
              property: 'fontSize',
              scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
            },
          })
          .asElement('h1');
      `;

      const extracted = extractStylesFromCode(logoCode);

      expect(extracted).toHaveLength(1);
      const logoStyle = extracted[0];

      // Verify component name
      expect(logoStyle.componentName).toBe('Logo');

      // Verify base styles
      expect(logoStyle.baseStyles).toEqual({
        width: 'max-content',
        fontSize: 30,
        m: 0,
        lineHeight: 'initial',
        fontFamily: 'logo',
        letterSpacing: '2px',
        gradient: 'flowX',
        backgroundSize: '300px 100px',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textShadow: 'logo',
        transition: 'text',
      });

      // Verify states
      expect(logoStyle.states).toEqual({
        link: {
          animation: 'none',
          '&:hover': {
            textShadow: 'logo-hover',
          },
          '&:active': {
            textShadow: 'link-pressed',
          },
        },
      });

      // Verify groups
      expect(logoStyle.groups).toEqual(['typography']);

      // Verify props
      expect(logoStyle.props).toEqual({
        logoSize: {
          property: 'fontSize',
          scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
        },
      });
    });

    it('extracts component with responsive values', () => {
      const code = `
        const HeaderSection = animus
          .styles({
            display: 'grid',
            gap: { _: 24, sm: 32 },
            flow: 'column',
            alignItems: 'center',
            flex: 1,
          })
          .variant({
            prop: 'direction',
            variants: {
              left: {},
              right: {
                justifyContent: 'end',
              },
            },
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);

      expect(extracted).toHaveLength(1);
      const headerStyle = extracted[0];

      // Verify component name
      expect(headerStyle.componentName).toBe('HeaderSection');

      // Verify base styles with responsive values
      expect(headerStyle.baseStyles).toEqual({
        display: 'grid',
        gap: { _: 24, sm: 32 },
        flow: 'column',
        alignItems: 'center',
        flex: 1,
      });

      // Verify variant structure
      expect(headerStyle.variants).toEqual({
        prop: 'direction',
        variants: {
          left: {},
          right: {
            justifyContent: 'end',
          },
        },
      });
    });

    it('extracts navigation component with complex states', () => {
      const code = `
        const Navigation = animus
          .styles({
            position: { _: 'fixed', sm: 'sticky' },
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            backgroundColor: 'white',
            borderBottom: '1px solid',
            borderColor: 'gray.200',
            transition: 'transform 0.3s ease',
          })
          .states({
            hidden: {
              transform: 'translateY(-100%)',
            },
            scrolled: {
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            },
            open: {
              height: '100vh',
              overflow: 'auto',
            }
          })
          .asElement('nav');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted[0].baseStyles.position).toEqual({
        _: 'fixed',
        sm: 'sticky',
      });
      expect(extracted[0].states).toHaveProperty('hidden');
      expect(extracted[0].states).toHaveProperty('scrolled');
      expect(extracted[0].states).toHaveProperty('open');
    });
  });

  describe('CSS Generation', () => {
    it('generates CSS for component with all features', () => {
      const code = `
        const Button = animus
          .styles({
            padding: '8px 16px',
            backgroundColor: 'blue',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: 'darkblue',
            },
          })
          .variant({
            prop: 'variant',
            variants: {
              primary: {
                backgroundColor: 'darkblue',
              },
              secondary: {
                backgroundColor: 'gray',
                color: 'black',
              },
            },
          })
          .states({
            disabled: {
              opacity: 0.5,
              cursor: 'not-allowed',
            },
          })
          .asElement('button');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        {},
        testTheme
      );

      // Check base styles
      expect(result.css).toContain('padding: 8px 16px');
      expect(result.css).toContain('background-color: blue');
      expect(result.css).toContain('color: var(--animus-colors-white)');
      expect(result.css).toContain('cursor: pointer');

      // Check hover state
      expect(result.css).toContain(':hover');
      expect(result.css).toContain('background-color: darkblue');

      // Check variants
      expect(result.css).toContain('variant-primary');
      expect(result.css).toContain('variant-secondary');

      // Check disabled state
      expect(result.css).toContain('state-disabled');
      expect(result.css).toContain('opacity: 0.5');
      expect(result.css).toContain('cursor: not-allowed');
    });

    it('generates CSS for layered button pattern', () => {
      const code = `
        // Container handles background effects
        const ButtonContainer = animus
          .styles({
            position: 'relative',
            overflow: 'hidden',
            display: 'inline-block',
            borderRadius: '4px',
          })
          .variant({
            prop: 'variant',
            variants: {
              fill: {
                '&:before': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  gradient: 'flowX',
                  backgroundSize: '300px 100%',
                  transition: 'background-position 0.3s ease',
                },
                '&:hover:before': {
                  backgroundPosition: '-100px 0%',
                }
              },
              stroke: {
                '&:before': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  gradient: 'flowX',
                  zIndex: 0,
                },
                '&:after': {
                  content: '""',
                  position: 'absolute',
                  inset: 2,
                  bg: 'background-current',
                  zIndex: 0,
                }
              }
            }
          })
          .asElement('div');

        // Foreground handles text/content
        const ButtonForeground = animus
          .styles({
            position: 'relative',
            zIndex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          })
          .variant({
            prop: 'size',
            variants: {
              sm: { px: 12, py: 6, fontSize: 14 },
              md: { px: 16, py: 8, fontSize: 16 },
              lg: { px: 20, py: 10, fontSize: 18 }
            }
          })
          .asElement('span');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted).toHaveLength(2);

      // Container component
      const container = extracted[0];
      expect(container.componentName).toBe('ButtonContainer');
      expect(container.variants.prop).toBe('variant');
      expect(container.variants.variants.fill['&:before']).toBeDefined();
      expect(container.variants.variants.stroke['&:after']).toBeDefined();

      // Foreground component
      const foreground = extracted[1];
      expect(foreground.componentName).toBe('ButtonForeground');
      expect(foreground.variants.prop).toBe('size');
      expect(foreground.variants.variants.sm).toMatchObject({
        px: 12,
        py: 6,
        fontSize: 14,
      });
    });

    it('generates CSS for grid layout pattern', () => {
      const code = `
        const Layout = animus
          .styles({
            display: 'grid',
            height: '100vh',
            gridTemplateAreas: {
              _: '"header header" "content content"',
              sm: '"header header" "sidebar content"',
            },
            gridTemplateColumns: { _: '1fr', sm: '15rem 1fr' },
            gridTemplateRows: 'auto 1fr',
          })
          .states({
            sidebar: {
              gridTemplateAreas: {
                _: '"header header" "content content"',
                sm: '"header header" "sidebar content"',
              },
              gridTemplateColumns: { _: '1fr', sm: '15rem 1fr' },
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const result = generator.generateFromExtracted(
        extracted[0],
        {},
        testTheme
      );

      // Check responsive grid template areas
      expect(result.css).toContain(
        'grid-template-areas: "header header" "content content"'
      );
      expect(result.css).toContain('@media');
      expect(result.css).toContain(
        'grid-template-areas: "header header" "sidebar content"'
      );

      // Check responsive grid template columns
      expect(result.css).toContain('grid-template-columns: 1fr');
      expect(result.css).toContain('grid-template-columns: 15rem 1fr');
    });
  });

  describe('Real-world Component Patterns', () => {
    it('handles card component with elevation variants', () => {
      const code = `
        const Card = animus
          .styles({
            backgroundColor: 'white',
            borderRadius: { _: '8px', lg: '12px' },
            padding: { _: '16px', sm: '20px', lg: '24px' },
            transition: 'all 0.2s ease',
          })
          .variant({
            prop: 'elevation',
            variants: {
              flat: {
                boxShadow: 'none',
                border: '1px solid #e0e0e0',
              },
              raised: {
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                '&:hover': {
                  boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                  transform: 'translateY(-2px)',
                }
              },
              floating: {
                boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
                '&:hover': {
                  boxShadow: '0 12px 24px rgba(0,0,0,0.2)',
                  transform: 'translateY(-4px)',
                }
              }
            }
          })
          .states({
            interactive: {
              cursor: 'pointer',
              userSelect: 'none',
            },
            selected: {
              borderColor: 'blue',
              borderWidth: '2px',
            }
          })
          .groups({ space: true })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      const component = extracted[0];

      // Verify responsive values in base styles
      expect(component.baseStyles.borderRadius).toEqual({
        _: '8px',
        lg: '12px',
      });
      expect(component.baseStyles.padding).toEqual({
        _: '16px',
        sm: '20px',
        lg: '24px',
      });

      // Verify elevation variants
      expect(component.variants.variants.raised).toHaveProperty('&:hover');
      expect(component.variants.variants.floating.boxShadow).toBe(
        '0 8px 16px rgba(0,0,0,0.15)'
      );

      // Verify states
      expect(component.states.interactive.cursor).toBe('pointer');
      expect(component.states.selected.borderColor).toBe('blue');
    });

    it('handles form input component with focus states', () => {
      const code = `
        const Input = animus
          .styles({
            width: '100%',
            padding: '8px 12px',
            fontSize: '16px',
            lineHeight: 1.5,
            border: '1px solid #d0d0d0',
            borderRadius: '4px',
            backgroundColor: 'white',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            '&:focus': {
              outline: 'none',
              borderColor: '#007bff',
              boxShadow: '0 0 0 3px rgba(0, 123, 255, 0.25)',
            },
            '&::placeholder': {
              color: '#6c757d',
              opacity: 1,
            }
          })
          .variant({
            prop: 'size',
            variants: {
              sm: { padding: '4px 8px', fontSize: '14px' },
              lg: { padding: '12px 16px', fontSize: '18px' }
            }
          })
          .states({
            error: {
              borderColor: '#dc3545',
              '&:focus': {
                borderColor: '#dc3545',
                boxShadow: '0 0 0 3px rgba(220, 53, 69, 0.25)',
              }
            },
            disabled: {
              backgroundColor: '#e9ecef',
              cursor: 'not-allowed',
              opacity: 0.6,
            }
          })
          .asElement('input');
      `;

      const extracted = extractStylesFromCode(code);
      const input = extracted[0];

      // Verify focus styles
      expect(input.baseStyles['&:focus']).toMatchObject({
        outline: 'none',
        borderColor: '#007bff',
        boxShadow: '0 0 0 3px rgba(0, 123, 255, 0.25)',
      });

      // Verify placeholder styles
      expect(input.baseStyles['&::placeholder']).toMatchObject({
        color: '#6c757d',
        opacity: 1,
      });

      // Verify error state with nested focus
      expect(input.states.error['&:focus']).toMatchObject({
        borderColor: '#dc3545',
        boxShadow: '0 0 0 3px rgba(220, 53, 69, 0.25)',
      });
    });

    it('handles modal component with animation states', () => {
      const code = `
        const Modal = animus
          .styles({
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            opacity: 0,
            visibility: 'hidden',
            transition: 'opacity 0.3s ease, visibility 0.3s ease',
            zIndex: 1000,
          })
          .states({
            open: {
              opacity: 1,
              visibility: 'visible',
            }
          })
          .asElement('div');

        const ModalContent = animus
          .styles({
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: { _: '20px', sm: '32px' },
            maxWidth: { _: '90vw', sm: '500px' },
            maxHeight: '90vh',
            overflow: 'auto',
            transform: 'scale(0.9)',
            transition: 'transform 0.3s ease',
          })
          .states({
            open: {
              transform: 'scale(1)',
            }
          })
          .asElement('div');
      `;

      const extracted = extractStylesFromCode(code);
      expect(extracted).toHaveLength(2);

      // Modal backdrop
      const modal = extracted[0];
      expect(modal.componentName).toBe('Modal');
      expect(modal.baseStyles.visibility).toBe('hidden');
      expect(modal.states.open.visibility).toBe('visible');

      // Modal content
      const content = extracted[1];
      expect(content.componentName).toBe('ModalContent');
      expect(content.baseStyles.transform).toBe('scale(0.9)');
      expect(content.states.open.transform).toBe('scale(1)');
    });
  });
});
