import { Text } from '@syzygos/components';
import { animus, compatTheme } from '@syzygos/core';
import { Prop } from '@syzygos/core/dist/types/config';
import { kebabCase, uniq } from 'lodash';
import { Fragment, useMemo } from 'react';

import { Code } from '../elements/Code';
import { Table } from '../elements/Tables';

export const PropTable = ({
  group,
}: {
  group: keyof typeof animus['groupRegistry'];
}) => {
  return (
    <Table>
      <Table.Row header>
        <Table.Cell size="sm">Prop</Table.Cell>
        <Table.Cell fill>Properties</Table.Cell>
        <Table.Cell size="xs">Scale</Table.Cell>
      </Table.Row>
      {animus.groupRegistry[group].map((prop) => {
        const {
          property,
          properties = [property],
          scale,
        } = animus.propRegistry[prop] as Prop;

        return (
          <Table.Row key={prop}>
            <Table.Cell size="sm">
              <Code fontSize={14}>{prop}</Code>
            </Table.Cell>
            <Table.Cell fill>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={pn}>
                  <Code fontSize={14} key={pn}>
                    {pn}
                  </Code>
                  <Text mr={4}>{arr.length !== i + 1 ? ', ' : ''}</Text>
                </Fragment>
              ))}
            </Table.Cell>
            <Table.Cell size="xs">
              <Code fontSize={14}>
                {typeof scale === 'object'
                  ? JSON.stringify(scale)
                  : String(scale)}
              </Code>
            </Table.Cell>
          </Table.Row>
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
      <Table.Row header>
        <Table.Cell size="xs">Scale</Table.Cell>
        <Table.Cell fill>Properties</Table.Cell>
      </Table.Row>
      {propertiesByScale.map(({ scale, properties }) => {
        return (
          <Table.Row key={scale}>
            <Table.Cell size="xs">
              <Code fontSize={14}>{scale}</Code>
            </Table.Cell>
            <Table.Cell fill>
              {properties.map(kebabCase).map((pn, i, arr) => (
                <Fragment key={`${scale}-${pn}`}>
                  <Code fontSize={14} key={pn}>
                    {pn}
                  </Code>
                  <Text mr={4}>{arr.length !== i + 1 ? ', ' : ''}</Text>
                </Fragment>
              ))}
            </Table.Cell>
          </Table.Row>
        );
      })}
    </Table>
  );
};
