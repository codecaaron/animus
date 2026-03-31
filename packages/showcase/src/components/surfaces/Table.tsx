import { ds } from '../../ds';

export const TableContainer = ds
  .styles({
    width: '100%',
    overflowX: 'auto',
    borderCollapse: 'collapse',
    my: 24,
  })
  .asElement('table');

export const Th = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textAlign: 'left',
    color: 'text.muted',
    py: 12,
    px: 16,
    borderBottom: 2,
    borderColor: 'border',
    whiteSpace: 'nowrap',
  })
  .asElement('th');

export const Td = ds
  .styles({
    fontFamily: 'body',
    fontSize: 14,
    color: 'text',
    py: 12,
    px: 16,
    borderBottom: 1,
    borderColor: 'border',
    verticalAlign: 'top',
  })
  .asElement('td');
