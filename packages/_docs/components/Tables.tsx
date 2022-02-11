import { Text } from '@animus-ui/components';
import {
  animus,
  borderShorthand,
  compatTheme,
  numberToPx,
} from '@animus-ui/core';
import { Prop } from '@animus-ui/core/dist/types/config';
import {
  get,
  identity,
  isArray,
  isEmpty,
  isNumber,
  kebabCase,
  size,
} from 'lodash';
import { Fragment } from 'react';

import { Code } from './Code';

const transforms = {
  radii: size,
  borders: borderShorthand,
  spacing: numberToPx,
  fontSize: numberToPx,
  breakpoints: numberToPx,
};

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

export const ScaleTable = ({ scale }: { scale: keyof typeof compatTheme }) => {
  const values = compatTheme[scale];
  const sorted =
    isArray(values) && isNumber(parseInt(`${values[0]}`, 10))
      ? values.sort((a, b) => (a > b ? 1 : -1))
      : values;

  const transform = get(transforms, scale, identity);

  return (
    <Table>
      <TableRow header>
        <TableHeader>Alias</TableHeader>
        <TableHeader>Value</TableHeader>
      </TableRow>
      {isArray(sorted)
        ? sorted.map((value) => {
            return (
              <TableRow key={value}>
                <TableCell>
                  <Code>{value}</Code>
                </TableCell>
                <TableCell>
                  <Code>{transform(value)}</Code>
                </TableCell>
              </TableRow>
            );
          })
        : Object.entries(sorted).map(([scaleKey, value]) => {
            if (isEmpty(sorted)) return null;

            return (
              <TableRow key={scaleKey}>
                <TableCell>
                  <Code>{scaleKey}</Code>
                </TableCell>
                <TableCell>
                  <Code>{transform(value)}</Code>
                </TableCell>
              </TableRow>
            );
          })}
    </Table>
  );
};
