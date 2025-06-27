import { Prop } from '@animus-ui/core/dist/types/config';
import { kebabCase, uniq } from 'lodash';
import { Fragment, useMemo } from 'react';

import { Text } from '@animus-ui/components';
import { animus, compatTheme } from '@animus-ui/core';

import { Code } from '../elements/Code';
import { Table, TableCell, TableRow } from '../elements/Tables';

export const PropTable = ({
  group,
}: {
  group: keyof (typeof animus)['groupRegistry'];
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
              <Code fontSize={14}>
                {typeof scale === 'object'
                  ? JSON.stringify(scale)
                  : scale !== undefined ? String(scale) : null}
              </Code>
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
      const properties = uniq(
        props.reduce((carry, config: Prop) => {
          if (config.scale !== scaleKey) return carry;
          const propertyNames = config.properties
            ? [...config.properties, config.property]
            : [config.property];
          return carry.concat(propertyNames);
        }, [])
      );
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
                <Fragment key={`${scale}-${pn}`}>
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
