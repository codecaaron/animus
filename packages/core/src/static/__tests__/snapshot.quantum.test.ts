import { describe, expect, it } from 'vitest';

import { extractAndGenerateCSS } from '../index';

/**
 * QUANTUM TEST: Integration Snapshots
 *
 * This test suite validates the complete extraction and generation
 * pipeline using snapshot testing for CSS output consistency.
 */

describe('[QUANTUM] Animus Static Extraction Integration', () => {
  it('generates CSS for complex Button and Card components', () => {
    const code = `
import { animus } from '@animus-ui/core';

const Button = animus
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    fontSize: 16,
    fontWeight: 500,
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    '&:hover': {
      backgroundColor: '#0056b3',
      transform: 'translateY(-1px)',
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)'
    },
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
    }
  })
  .variant({
    prop: 'size',
    variants: {
      small: {
        padding: 8,
        fontSize: 14
      },
      large: {
        padding: 16,
        fontSize: 18
      }
    }
  })
  .states({
    disabled: {
      opacity: 0.6,
      cursor: 'not-allowed',
      '&:hover': {
        backgroundColor: '#007bff',
        transform: 'none'
      }
    }
  })
  .asElement('button');

const Card = animus
  .styles({
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 20,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    transition: 'box-shadow 0.2s ease',
    '&:hover': {
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
    }
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('button-card-integration');
  });

  it('generates CSS for component with groups and props', () => {
    const code = `
const Box = animus
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  })
  .groups({
    space: true,
    color: true,
  })
  .props({
    cols: {
      property: 'gridTemplateColumns',
      scale: 'grid',
    }
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('groups-props-integration');
  });

  it('generates CSS for responsive component', () => {
    const code = `
const ResponsiveBox = animus
  .styles({
    padding: { _: 10, sm: 20, lg: 40 },
    margin: [5, 10, 15],
    fontSize: 16,
    display: 'flex',
    gap: { _: 8, md: 16 },
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('responsive-integration');
  });

  it('generates CSS for complex nested selectors', () => {
    const code = `
const NavLink = animus
  .styles({
    display: 'block',
    padding: '8px 16px',
    color: 'gray',
    textDecoration: 'none',
    transition: 'all 0.2s',
    '&:hover': {
      color: 'blue',
      backgroundColor: 'rgba(0, 0, 255, 0.1)',
    },
    '&:active': {
      backgroundColor: 'rgba(0, 0, 255, 0.2)',
    },
    '&:focus': {
      outline: '2px solid blue',
      outlineOffset: 2,
    },
    '&.active': {
      color: 'darkblue',
      fontWeight: 600,
      '&:hover': {
        backgroundColor: 'rgba(0, 0, 255, 0.15)',
      }
    }
  })
  .asElement('a');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('nested-selectors-integration');
  });

  it('generates CSS for theme-aware components', () => {
    const code = `
const ThemedButton = animus
  .styles({
    padding: '8px 16px',
    backgroundColor: 'colors.primary',
    color: 'colors.white',
    borderRadius: 'radii.medium',
    fontSize: 'fontSizes.base',
    fontWeight: 'fontWeights.medium',
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: 'colors.primaryDark',
      transform: 'translateY(-1px)',
      boxShadow: 'shadows.medium',
    }
  })
  .variant({
    prop: 'size',
    variants: {
      small: {
        padding: 'space.2 space.3',
        fontSize: 'fontSizes.sm',
      },
      large: {
        padding: 'space.4 space.6',
        fontSize: 'fontSizes.lg',
      }
    }
  })
  .asElement('button');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('theme-aware-integration');
  });

  it('generates CSS for complex layout component', () => {
    const code = `
const GridLayout = animus
  .styles({
    display: 'grid',
    gap: { _: '16px', sm: '24px', lg: '32px' },
    gridTemplateColumns: {
      _: 'repeat(auto-fill, minmax(250px, 1fr))',
      lg: 'repeat(auto-fill, minmax(300px, 1fr))'
    },
    padding: { _: '16px', sm: '24px', lg: '32px' },
  })
  .variant({
    prop: 'columns',
    variants: {
      2: {
        gridTemplateColumns: 'repeat(2, 1fr)',
      },
      3: {
        gridTemplateColumns: 'repeat(3, 1fr)',
      },
      4: {
        gridTemplateColumns: 'repeat(4, 1fr)',
      }
    }
  })
  .asElement('div');

const GridItem = animus
  .styles({
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    }
  })
  .variant({
    prop: 'span',
    variants: {
      2: { gridColumn: 'span 2' },
      3: { gridColumn: 'span 3' },
      full: { gridColumn: '1 / -1' }
    }
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('grid-layout-integration');
  });

  it('generates CSS for animation-heavy component', () => {
    const code = `
const AnimatedCard = animus
  .styles({
    position: 'relative',
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: '-100%',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
      transition: 'left 0.5s ease',
    },
    '&:hover': {
      transform: 'scale(1.02)',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
      '&::before': {
        left: '100%',
      }
    },
    '&:active': {
      transform: 'scale(0.98)',
    }
  })
  .states({
    loading: {
      pointerEvents: 'none',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '24px',
        height: '24px',
        margin: '-12px 0 0 -12px',
        border: '2px solid #f3f3f3',
        borderTop: '2px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }
    }
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('animated-card-integration');
  });

  it('generates CSS for compound component pattern', () => {
    const code = `
const TabsContainer = animus
  .styles({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  })
  .asElement('div');

const TabsList = animus
  .styles({
    display: 'flex',
    borderBottom: '2px solid #e0e0e0',
    overflow: 'auto',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    }
  })
  .variant({
    prop: 'variant',
    variants: {
      pills: {
        borderBottom: 'none',
        gap: '8px',
        padding: '4px',
        backgroundColor: '#f0f0f0',
        borderRadius: '8px',
      }
    }
  })
  .asElement('div');

const TabsTrigger = animus
  .styles({
    padding: '12px 24px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    color: '#666',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    '&:hover': {
      color: '#333',
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
    }
  })
  .states({
    active: {
      color: '#000',
      borderBottomColor: '#007bff',
    }
  })
  .variant({
    prop: 'variant',
    parent: 'pills',
    variants: {
      pills: {
        borderBottom: 'none',
        borderRadius: '6px',
        marginBottom: 0,
        '&[data-active="true"]': {
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        }
      }
    }
  })
  .asElement('button');

const TabsContent = animus
  .styles({
    padding: '24px 0',
    animation: 'fadeIn 0.3s ease',
    '@keyframes fadeIn': {
      from: { opacity: 0 },
      to: { opacity: 1 }
    }
  })
  .asElement('div');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('compound-tabs-integration');
  });

  it('generates CSS for form components suite', () => {
    const code = `
const FormField = animus
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '16px',
  })
  .asElement('div');

const Label = animus
  .styles({
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    lineHeight: 1.5,
  })
  .states({
    required: {
      '&::after': {
        content: '" *"',
        color: '#dc3545',
      }
    }
  })
  .asElement('label');

const Input = animus
  .styles({
    width: '100%',
    padding: '8px 12px',
    fontSize: '16px',
    lineHeight: 1.5,
    color: '#495057',
    backgroundColor: 'white',
    backgroundClip: 'padding-box',
    border: '1px solid #ced4da',
    borderRadius: '4px',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    '&:focus': {
      color: '#495057',
      backgroundColor: 'white',
      borderColor: '#80bdff',
      outline: 0,
      boxShadow: '0 0 0 0.2rem rgba(0, 123, 255, 0.25)',
    },
    '&::placeholder': {
      color: '#6c757d',
      opacity: 1,
    }
  })
  .variant({
    prop: 'size',
    variants: {
      sm: {
        padding: '5px 10px',
        fontSize: '12px',
        borderRadius: '3px',
      },
      lg: {
        padding: '10px 16px',
        fontSize: '18px',
        borderRadius: '6px',
      }
    }
  })
  .states({
    error: {
      borderColor: '#dc3545',
      '&:focus': {
        borderColor: '#dc3545',
        boxShadow: '0 0 0 0.2rem rgba(220, 53, 69, 0.25)',
      }
    },
    success: {
      borderColor: '#28a745',
      '&:focus': {
        borderColor: '#28a745',
        boxShadow: '0 0 0 0.2rem rgba(40, 167, 69, 0.25)',
      }
    }
  })
  .asElement('input');

const HelperText = animus
  .styles({
    fontSize: '12px',
    lineHeight: 1.5,
    color: '#6c757d',
  })
  .states({
    error: {
      color: '#dc3545',
    },
    success: {
      color: '#28a745',
    }
  })
  .asElement('span');
`;

    const result = extractAndGenerateCSS(code);
    expect(result).toMatchSnapshot('form-components-integration');
  });
});
