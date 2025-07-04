import { extractAndGenerateCSS } from '../index';

describe('Animus Static Extraction Integration', () => {
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
});
