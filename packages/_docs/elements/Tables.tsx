import { animus } from '@animus-ui/core';

const TableBase = animus
  .styles({
    mt: 16,
    mb: 24,
    fontSize: 14,
    display: 'grid',
    maxWidth: 1200,
    width: 1,
  })
  .asElement('div');

const TableRow = animus
  .styles({
    display: 'flex',
    px: 16,
    '&:nth-child(even)': {
      bg: 'syntax-background',
    },
  })
  .states({
    header: {
      border: 'none',
      bg: 'transparent',
    },
  })
  .asElement('div');

const TableCell = animus
  .styles({
    py: 12,
    flexBasis: '350px',
  })
  .states({
    max: {
      flexBasis: '150px',
    },
    fill: {
      flex: 1,
    },
  })
  .props({
    size: {
      property: 'flexBasis',
      scale: { xs: '10rem', sm: '15rem' },
    },
  })
  .asElement('div');

const Table = Object.assign(TableBase, { Cell: TableCell, Row: TableRow });

export { Table };
