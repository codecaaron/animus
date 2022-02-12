import { animus, compatTheme } from '@animus-ui/core';
import { Prop } from '@animus-ui/core/dist/types/config';
import { kebabCase } from 'lodash';
import { Fragment, useMemo } from 'react';

import { Code } from './Code';

const Table = animus
  .styles({
    my: 16,
    mb: 24,
    fontSize: 16,
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
      </TableRow>
      {animus.groupRegistry[group].map((prop) => {
        const {
          property,
          properties = [property],
          scale,
        } = animus.propRegistry[prop] as Prop;

        return (
          <TableRow key={prop}>
            <TableCell>
              <Code>{prop}</Code>
            </TableCell>
            <TableCell>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code key={pn}>{pn}</Code>
                  {arr.length !== i + 1 ? ', ' : ''}
                </Fragment>
              ))}
            </TableCell>
            <TableCell>
              <Code>{scale}</Code>
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};

export const ScaleTable = () => {
  const propertiesByScale = useMemo(() => {
    const values = Object.keys(compatTheme).filter(
      (key) => !['breakpoints', 'mode', 'modes'].includes(key)
    );
    const props = Object.values(animus.propRegistry);
    return values.map((scaleKey) => {
      const properties = props.reduce((carry, config: Prop) => {
        if (config.scale !== scaleKey) return carry;
        const propertyNames = config.properties
          ? [...config.properties, config.property]
          : [config.property];
        return carry.concat(propertyNames);
      }, []);
      return { scale: scaleKey, properties };
    });
  }, []);
  return (
    <Table>
      <TableRow header>
        <TableHeader>Scale</TableHeader>
        <TableHeader>Properties</TableHeader>
      </TableRow>
      {propertiesByScale.map(({ scale, properties }) => {
        return (
          <TableRow key={scale}>
            <TableCell>
              <Code>{scale}</Code>
            </TableCell>
            <TableCell>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code key={pn}>{pn}</Code>
                  {arr.length !== i + 1 ? ', ' : ''}
                </Fragment>
              ))}
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};
