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
    fontSize: '12px',
    fontWeight: '500',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textAlign: 'left',
    color: 'textMuted',
    py: 12,
    px: 16,
    borderBottom: '2px solid',
    borderColor: 'ash',
    whiteSpace: 'nowrap',
  })
  .asElement('th');

export const Td = ds
  .styles({
    fontFamily: 'body',
    fontSize: '14px',
    color: 'text',
    py: 12,
    px: 16,
    borderBottom: '1px solid',
    borderColor: 'ash',
    verticalAlign: 'top',
  })
  .asElement('td');
