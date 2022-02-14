import { Text } from '@animus-ui/components';
import { animus, compatTheme } from '@animus-ui/core';
import { Prop } from '@animus-ui/core/dist/types/config';
import { kebabCase } from 'lodash';
import { Fragment, useMemo } from 'react';

import { Code } from './Code';

const Table = animus
  .styles({
    mt: 16,
    mb: 24,
    fontSize: 14,
    display: 'grid',
    maxWidth: 1200,
    width: 1,
  })
  .asComponent('div');

const TableRow = animus
  .styles({
    display: 'flex',
    px: 16,
    '&:nth-child(even)': {
      bg: 'modifier-darken-200',
    },
  })
  .states({
    header: {
      border: 'none',
      bg: 'transparent',
    },
  })
  .asComponent('div');

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
  .asComponent('div');

export const PropTable = ({
  group,
}: {
  group: keyof typeof animus['groupRegistry'];
}) => {
  return (
    <Table>
      <TableRow header>
        <TableCell size="sm">Prop</TableCell>
        <TableCell fill>Properties</TableCell>
        <TableCell size="xs">Scale</TableCell>
      </TableRow>
      {animus.groupRegistry[group].map((prop) => {
        const {
          property,
          properties = [property],
          scale,
        } = animus.propRegistry[prop] as Prop;

        return (
          <TableRow key={prop}>
            <TableCell size="sm">
              <Code fontSize={14}>{prop}</Code>
            </TableCell>
            <TableCell fill>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code fontSize={14} key={pn}>
                    {pn}
                  </Code>
                  <Text mr={4}>{arr.length !== i + 1 ? ', ' : ''}</Text>
                </Fragment>
              ))}
            </TableCell>
            <TableCell size="xs">
              <Code fontSize={14}>{scale}</Code>
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
        <TableCell size="xs">Scale</TableCell>
        <TableCell fill>Properties</TableCell>
      </TableRow>
      {propertiesByScale.map(({ scale, properties }) => {
        return (
          <TableRow key={scale}>
            <TableCell size="xs">
              <Code fontSize={14}>{scale}</Code>
            </TableCell>
            <TableCell fill>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code fontSize={14} key={pn}>
                    {pn}
                  </Code>
                  <Text mr={4}>{arr.length !== i + 1 ? ', ' : ''}</Text>
                </Fragment>
              ))}
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};
