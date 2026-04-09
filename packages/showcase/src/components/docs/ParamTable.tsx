import { ds } from '../../ds';
import { TableContainer, Td, Th } from '../surfaces/Table';

import { TokenBadge } from './TokenBadge';

const ParamName = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: '{colors.gold.300}',
  })
  .asElement('span');

const RequiredMark = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: 'primary',
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
            </Td>
            <Td>
              <TokenBadge variant="type">{p.type}</TokenBadge>
            </Td>
            <Td>
              {p.default === 'required' ? (
                <RequiredMark>{p.default}</RequiredMark>
              ) : (
                <DefaultValue>{p.default}</DefaultValue>
              )}
            </Td>
            <DescriptionCell>{p.desc}</DescriptionCell>
          </tr>
        ))}
      </tbody>
    </TableContainer>
  );
}
