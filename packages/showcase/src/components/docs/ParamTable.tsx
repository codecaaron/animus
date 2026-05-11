import { ds } from '../../ds';
import { TableContainer, Td, Th } from '../surfaces/Table';
import { TokenBadge } from './TokenBadge';

const ParamName = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: 'gold.300',
  })
  .asElement('span');

const RequiredDot = ds
  .styles({
    display: 'inline-block',
    width: '5px',
    height: '5px',
    bg: 'primary',
    borderRadius: '50%',
    ml: 4,
    verticalAlign: 'middle',
  })
  .asElement('span');

const DefaultValue = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: 'text.dim',
  })
  .asElement('span');

const DescriptionCell = ds
  .styles({
    fontFamily: 'body',
    fontSize: 13,
    color: 'text.muted',
    lineHeight: 'base',
    py: 12,
    px: 16,
    borderBottom: 1,
    borderColor: 'border',
    verticalAlign: 'top',
  })
  .asElement('td');

interface Param {
  name: string;
  type: string;
  default: string;
  desc: string;
}

export function ParamTable({ params }: { params: Param[] }) {
  return (
    <TableContainer>
      <thead>
        <tr>
          <Th>Parameter</Th>
          <Th>Type</Th>
          <Th>Default</Th>
          <Th>Description</Th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <Td>
              <ParamName>{p.name}</ParamName>
              {p.default === 'required' && <RequiredDot />}
            </Td>
            <Td>
              <TokenBadge variant="type">{p.type}</TokenBadge>
            </Td>
            <Td>
              <DefaultValue>
                {p.default === 'required' ? '—' : p.default}
              </DefaultValue>
            </Td>
            <DescriptionCell>{p.desc}</DescriptionCell>
          </tr>
        ))}
      </tbody>
    </TableContainer>
  );
}
