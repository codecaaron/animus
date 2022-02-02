import { Text } from '@animus-ui/components';
import { animus, compatTheme } from '@animus-ui/core';
import { Prop } from '@animus-ui/core/dist/types/config';
import { isArray, isEmpty, isNumber, kebabCase } from 'lodash';
import { Fragment } from 'react';

import { Code } from './Code';

const Table = animus
  .styles({
    my: 16,
    mb: 24,
    fontSize: 14,
    borderCollapse: 'collapse',
    width: 1,
  })
  .asComponent('table');

const TableRow = animus
  .styles({
    '&:nth-child(even)': {
      bg: 'modifier-darken-100',
    },
  })
  .states({
    header: {
      border: 'none',
      bg: 'transparent',
    },
  })
  .asComponent('tr');

const TableHeader = animus
  .styles({
    p: 8,
    px: 12,
  })
  .asComponent('th');

const TableCell = animus
  .styles({
    p: 12,
  })
  .asComponent('td');

export const PropTable = ({
  group,
}: {
  group: keyof typeof animus['groupRegistry'];
}) => {
  return (
    <Table>
      <TableRow header>
        <TableHeader>Prop</TableHeader>
        <TableHeader>Properties</TableHeader>
        <TableHeader>Scale</TableHeader>
        <TableHeader>Transform</TableHeader>
      </TableRow>
      {animus.groupRegistry[group].map((prop) => {
        const {
          property,
          properties = [property],
          scale,
          transform,
        } = animus.propRegistry[prop] as Prop;

        return (
          <TableRow key={prop}>
            <TableCell>{prop}</TableCell>
            <TableCell>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code key={pn}>
                    <Text fontSize={14}>{pn}</Text>
                  </Code>
                  {arr.length !== i + 1 ? ', ' : ''}
                </Fragment>
              ))}
            </TableCell>
            <TableCell>{scale}</TableCell>
            <TableCell>{transform?.name}</TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};

export const ScaleTable = () => {
  return (
    <Table>
      <TableRow header>
        <TableHeader>Alias</TableHeader>
        <TableHeader>Value</TableHeader>
      </TableRow>
      {Object.entries(compatTheme).map(([scale, values]) => {
        if (isEmpty(values)) return null;
        const sorted =
          isArray(values) && isNumber(parseInt(values[0], 10))
            ? values.sort((a, b) => (a > b ? 1 : -1))
            : values;

        return (
          <TableRow key={scale}>
            <TableCell>{scale}</TableCell>
            <TableCell>
              {isArray(sorted)
                ? sorted.join(', ')
                : Object.entries(sorted ?? {}).map(([key, value], i, arr) => (
                    <Text key={key}>
                      <Code>{key}</Code> ({value})
                      {arr.length !== i + 1 ? ', ' : ''}
                    </Text>
                  ))}
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};
